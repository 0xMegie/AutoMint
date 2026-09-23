// SPDX-License-Identifier: Apache-2.0

#![cfg(test)]
#![allow(clippy::inconsistent_digit_grouping)]
use super::*;
use automint_bot_nft::BotNFTContractClient;
use automint_registry::RegistryContractClient;
use automint_testutils::{deploy_all, deploy_bot_nft_with_registry, register_user};
use automint_token::AMTTokenClient;
use soroban_sdk::{testutils::Address as _, Env};

struct Harness<'a> {
    env: Env,
    admin: Address,
    registry: RegistryContractClient<'a>,
    bot: BotNFTContractClient<'a>,
    token: AMTTokenClient<'a>,
    mkt: MarketplaceContractClient<'a>,
}

fn setup() -> Harness<'static> {
    let deployment = deploy_all(Env::default());
    let registry = RegistryContractClient::new(&deployment.env, &deployment.registry_id);
    let bot = BotNFTContractClient::new(&deployment.env, &deployment.bot_nft_id);
    let token = AMTTokenClient::new(&deployment.env, &deployment.token_id);
    let mkt = MarketplaceContractClient::new(&deployment.env, &deployment.marketplace_id);

    Harness {
        env: deployment.env,
        admin: deployment.admin,
        registry,
        bot,
        token,
        mkt,
    }
}

#[test]
fn test_list_bot_escrows_and_returns_id() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);

    assert_eq!(h.bot.get_user_bots(&seller).len(), 1);

    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);
    assert_eq!(listing_id, 1);

    // The bot is escrowed into the marketplace contract.
    let bot = h.bot.get_bot(&bot_id);
    assert_eq!(bot.owner, h.mkt.address);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 0);

    // The listing is recorded with the supplied price and currency.
    let listing = h.mkt.get_listing(&listing_id);
    assert_eq!(listing.seller, seller);
    assert_eq!(listing.bot_id, bot_id);
    assert_eq!(listing.price, 50_0000000_i128);
    assert_eq!(listing.currency, h.token.address);
    assert!(listing.active);
}

#[test]
fn test_list_bot_ids_are_sequential() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let id1 = h.bot.mint_basic(&seller);
    let id2 = h.bot.mint_basic(&seller);

    let l1 = h
        .mkt
        .list_bot(&seller, &id1, &10_0000000_i128, &h.token.address);
    let l2 = h
        .mkt
        .list_bot(&seller, &id2, &20_0000000_i128, &h.token.address);
    assert_eq!(l1, 1);
    assert_eq!(l2, 2);

    assert_eq!(h.mkt.get_active_listings(&0, &100).len(), 2);
    assert_eq!(h.mkt.get_user_listings(&seller).len(), 2);
}

#[test]
fn test_list_bot_zero_price_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot_id, &0_i128, &h.token.address),
        Err(Ok(MarketplaceError::InvalidPrice))
    );
    // The bot is NOT escrowed when listing fails.
    assert_eq!(h.bot.get_user_bots(&seller).len(), 1);
}

#[test]
fn test_list_bot_negative_price_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &bot_id, &-1_i128, &h.token.address),
        Err(Ok(MarketplaceError::InvalidPrice))
    );
}

#[test]
fn test_list_nonexistent_bot_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    assert_eq!(
        h.mkt
            .try_list_bot(&seller, &999_u64, &10_0000000_i128, &h.token.address),
        Err(Ok(MarketplaceError::BotTransferFailed))
    );
}

#[test]
fn test_list_bot_not_owned_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let stranger = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);

    // `stranger` does not own the bot, so the escrow transfer must fail.
    assert_eq!(
        h.mkt
            .try_list_bot(&stranger, &bot_id, &10_0000000_i128, &h.token.address),
        Err(Ok(MarketplaceError::BotTransferFailed))
    );
    // Ownership is unchanged.
    assert_eq!(h.bot.get_bot(&bot_id).owner, seller);
}

#[test]
fn test_get_listing_not_found() {
    let h = setup();
    assert_eq!(
        h.mkt.try_get_listing(&404_u64),
        Err(Ok(MarketplaceError::ListingNotFound))
    );
}

#[test]
fn test_double_initialize_fails() {
    let h = setup();
    assert_eq!(
        h.mkt.try_initialize(&h.admin, &h.bot.address, &250u32),
        Err(Ok(MarketplaceError::AlreadyInitialized))
    );
}

#[test]
fn test_config_returns_admin_and_bot_nft() {
    let h = setup();
    let config = h.mkt.config();
    assert_eq!(config.admin, h.admin);
    assert_eq!(config.bot_nft, h.bot.address);
    assert_eq!(config.fee_bps, 250u32);
}

#[test]
fn test_active_listings_empty_initially() {
    let h = setup();
    assert_eq!(h.mkt.get_active_listings(&0, &100).len(), 0);
}

#[test]
fn test_buy_bot_pays_seller_minus_fee_and_transfers_bot() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let price = 1000_0000000_i128;

    // Fund buyer
    h.token.mint(&buyer, &price);

    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h.mkt.list_bot(&seller, &bot_id, &price, &h.token.address);

    let seller_balance_before = h.token.balance(&seller);
    let admin_balance_before = h.token.balance(&h.admin);

    h.mkt.buy_bot(&buyer, &listing_id);

    // 2.5% fee = 25_0000000, seller gets 975_0000000
    let fee = price * 25 / 1000;
    assert_eq!(
        h.token.balance(&seller),
        seller_balance_before + price - fee
    );
    assert_eq!(h.token.balance(&h.admin), admin_balance_before + fee);
    assert_eq!(h.token.balance(&buyer), 0);

    // Bot transferred to buyer
    assert_eq!(h.bot.get_bot(&bot_id).owner, buyer);
    assert_eq!(h.bot.get_user_bots(&buyer).len(), 1);

    // Listing is now inactive
    let listing = h.mkt.get_listing(&listing_id);
    assert!(!listing.active);
    assert_eq!(h.mkt.get_active_listings(&0, &100).len(), 0);
}

#[test]
fn test_cancel_listing_returns_bot_to_seller() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &100_0000000_i128, &h.token.address);

    // Bot is escrowed
    assert_eq!(h.bot.get_bot(&bot_id).owner, h.mkt.address);

    h.mkt.cancel_listing(&seller, &listing_id);

    // Bot returned to seller
    assert_eq!(h.bot.get_bot(&bot_id).owner, seller);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 1);

    // Listing is inactive and removed from active list
    let listing = h.mkt.get_listing(&listing_id);
    assert!(!listing.active);
    assert_eq!(h.mkt.get_active_listings(&0, &100).len(), 0);
}

#[test]
fn test_buy_inactive_listing_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let price = 100_0000000_i128;

    h.token.mint(&buyer, &(price * 2));
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h.mkt.list_bot(&seller, &bot_id, &price, &h.token.address);

    // Cancel the listing first
    h.mkt.cancel_listing(&seller, &listing_id);

    // Buying a cancelled listing must fail
    assert_eq!(
        h.mkt.try_buy_bot(&buyer, &listing_id),
        Err(Ok(MarketplaceError::ListingNotActive))
    );
}

#[test]
fn test_cancel_already_cancelled_listing_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);

    h.mkt.cancel_listing(&seller, &listing_id);

    assert_eq!(
        h.mkt.try_cancel_listing(&seller, &listing_id),
        Err(Ok(MarketplaceError::ListingNotActive))
    );
}

#[test]
fn test_cancel_listing_not_found() {
    let h = setup();
    let seller = Address::generate(&h.env);
    assert_eq!(
        h.mkt.try_cancel_listing(&seller, &404_u64),
        Err(Ok(MarketplaceError::ListingNotFound))
    );
}

#[test]
fn test_cancel_listing_by_non_seller_fails() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let stranger = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);

    assert_eq!(
        h.mkt.try_cancel_listing(&stranger, &listing_id),
        Err(Ok(MarketplaceError::Unauthorized))
    );
    // Listing still active
    assert!(h.mkt.get_listing(&listing_id).active);
}

// ── Issue #228: Cross-contract integration test: registry ↔ bot_nft ──────────

/// Test that minting a bot increments the user's bot_count in the registry.
/// Verifies the contract interaction path: bot_nft.mint_basic() → registry.increment_bot_count()
#[test]
fn test_bot_nft_registry_integration_mint_increments_bot_count() {
    let h = setup();

    // Register a user in the registry
    let user = Address::generate(&h.env);
    register_user(&h.env, &h.registry.address, &user, "testuser");

    // Verify initial bot_count is 0
    let profile_before = h.registry.get_user(&user);
    assert_eq!(profile_before.bot_count, 0);

    // Mint a bot for the user
    h.bot.mint_basic(&user);

    // Verify bot_count was incremented to 1
    let profile_after = h.registry.get_user(&user);
    assert_eq!(profile_after.bot_count, 1);

    // Mint another bot and verify increment
    h.bot.mint_basic(&user);
    let profile_after2 = h.registry.get_user(&user);
    assert_eq!(profile_after2.bot_count, 2);
}

/// Test that mint_basic still succeeds even if registry is not initialized or user is not registered.
/// The bot_nft contract should swallow registry errors gracefully.
#[test]
fn test_bot_nft_mint_succeeds_even_if_registry_not_initialized() {
    let h = setup();

    // Create a new bot_nft without a valid registry
    let admin = Address::generate(&h.env);
    let bad_registry = Address::generate(&h.env); // Not a real contract
    let (_bot_id, bot) = deploy_bot_nft_with_registry(&h.env, &admin, &bad_registry);

    let owner = Address::generate(&h.env);

    // mint_basic should still succeed despite registry error
    let bot_id = bot.mint_basic(&owner);
    assert_eq!(bot_id, 1);
    assert_eq!(bot.get_user_bots(&owner).len(), 1);
}

// ── Issue #231: Cross-contract integration test: bot_nft ↔ marketplace ──────

/// Test that listing a bot transfers ownership to the marketplace (escrowing).
/// Verifies: listing creates escrow and bot owner becomes marketplace contract.
#[test]
fn test_bot_nft_marketplace_integration_listing_escrows_bot() {
    let h = setup();
    let seller = Address::generate(&h.env);

    // Mint a bot for the seller
    let bot_id = h.bot.mint_basic(&seller);

    // Verify seller is the owner
    let bot_before = h.bot.get_bot(&bot_id);
    assert_eq!(bot_before.owner, seller);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 1);

    // List the bot at a price
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &100_0000000_i128, &h.token.address);
    assert_eq!(listing_id, 1);

    // Verify bot is now escrowed (owner is marketplace contract)
    let bot_after = h.bot.get_bot(&bot_id);
    assert_eq!(bot_after.owner, h.mkt.address);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 0);

    // Verify listing is active and has correct metadata
    let listing = h.mkt.get_listing(&listing_id);
    assert!(listing.active);
    assert_eq!(listing.seller, seller);
    assert_eq!(listing.bot_id, bot_id);
    assert_eq!(listing.price, 100_0000000_i128);
}

/// Test that cancelling a listing returns the escrowed bot to the seller.
/// Verifies: cancel_listing transfers bot back from marketplace to seller.
#[test]
fn test_bot_nft_marketplace_integration_cancel_returns_escrowed_bot() {
    let h = setup();
    let seller = Address::generate(&h.env);

    let bot_id = h.bot.mint_basic(&seller);
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);

    // Verify bot is escrowed
    assert_eq!(h.bot.get_bot(&bot_id).owner, h.mkt.address);

    // Cancel the listing
    h.mkt.cancel_listing(&seller, &listing_id);

    // Verify bot is returned to seller
    let bot_after_cancel = h.bot.get_bot(&bot_id);
    assert_eq!(bot_after_cancel.owner, seller);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 1);

    // Verify listing is inactive
    let listing = h.mkt.get_listing(&listing_id);
    assert!(!listing.active);
}

/// Test that a second purchase attempt on an escrowed bot fails (bot is locked in escrow).
/// Verifies: active listing prevents re-listing the same bot.
#[test]
fn test_bot_nft_marketplace_integration_escrowed_bot_cannot_be_listed_again() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let bot_id = h.bot.mint_basic(&seller);

    // List the bot
    let _listing_id = h
        .mkt
        .list_bot(&seller, &bot_id, &100_0000000_i128, &h.token.address);

    // Verify seller no longer owns the bot
    assert_eq!(h.bot.get_user_bots(&seller).len(), 0);

    // Attempt to list the same bot again should fail (seller is no longer owner)
    let result = h
        .mkt
        .try_list_bot(&seller, &bot_id, &100_0000000_i128, &h.token.address);
    assert_eq!(result, Err(Ok(MarketplaceError::BotTransferFailed)));
}

// ── Issue #232: Cross-contract integration test: marketplace ↔ token ↔ registry ──

/// Test full purchase flow: list bot → buyer transfers tokens → bot transferred to buyer.
/// Verifies all three contracts interact correctly in a full sale.
#[test]
fn test_marketplace_token_registry_integration_full_sale_with_updates() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer = Address::generate(&h.env);
    let price = 1000_0000000_i128;
    let fee = (price * 25) / 1000;
    let seller_receives = price - fee;

    // Register both users in registry
    register_user(&h.env, &h.registry.address, &seller, "seller");
    register_user(&h.env, &h.registry.address, &buyer, "buyer");

    // Fund buyer with tokens
    h.token.mint(&buyer, &(price * 2));

    // Seller mints a bot via bot_nft
    let bot_nft_id = h.bot.mint_basic(&seller);

    // Verify registry bot_count incremented for seller
    assert_eq!(h.registry.get_user(&seller).bot_count, 1);

    // Seller lists the bot at price on marketplace
    let listing_id = h
        .mkt
        .list_bot(&seller, &bot_nft_id, &price, &h.token.address);

    // Verify bot is escrowed
    assert_eq!(h.bot.get_bot(&bot_nft_id).owner, h.mkt.address);

    // Record balances before purchase
    let seller_balance_before = h.token.balance(&seller);
    let buyer_balance_before = h.token.balance(&buyer);
    let admin_balance_before = h.token.balance(&h.admin);

    // Buyer purchases the bot
    h.mkt.buy_bot(&buyer, &listing_id);

    // Verify token transfers: buyer pays full price, seller gets (price - fee), admin gets fee
    assert_eq!(h.token.balance(&buyer), buyer_balance_before - price);
    assert_eq!(
        h.token.balance(&seller),
        seller_balance_before + seller_receives
    );
    assert_eq!(h.token.balance(&h.admin), admin_balance_before + fee);

    // Verify bot ownership transferred to buyer
    assert_eq!(h.bot.get_bot(&bot_nft_id).owner, buyer);
    assert_eq!(h.bot.get_user_bots(&buyer).len(), 1);
    assert_eq!(h.bot.get_user_bots(&seller).len(), 0);

    // Verify listing is inactive
    assert!(!h.mkt.get_listing(&listing_id).active);

    // Verify seller bot_count remains 1 (mint incremented, transfer doesn't change bot_count)
    assert_eq!(h.registry.get_user(&seller).bot_count, 1);

    // Verify buyer bot_count remains 0 (transfer from marketplace to buyer doesn't increment)
    assert_eq!(h.registry.get_user(&buyer).bot_count, 0);
}

/// Test that multiple sequential purchases (multiple bots) work correctly.
/// Verifies: marketplace supports multiple listings and purchases without state corruption.
#[test]
fn test_marketplace_token_registry_integration_multiple_purchases() {
    let h = setup();
    let seller = Address::generate(&h.env);
    let buyer1 = Address::generate(&h.env);
    let buyer2 = Address::generate(&h.env);
    let price = 100_0000000_i128;

    // Fund both buyers
    h.token.mint(&buyer1, &(price * 2));
    h.token.mint(&buyer2, &(price * 2));

    // Mint two bots for seller
    let bot_id1 = h.bot.mint_basic(&seller);
    let bot_id2 = h.bot.mint_basic(&seller);

    // List both bots
    let listing_id1 = h.mkt.list_bot(&seller, &bot_id1, &price, &h.token.address);
    let listing_id2 = h.mkt.list_bot(&seller, &bot_id2, &price, &h.token.address);

    // Verify both are escrowed and active
    assert_eq!(h.bot.get_bot(&bot_id1).owner, h.mkt.address);
    assert_eq!(h.bot.get_bot(&bot_id2).owner, h.mkt.address);
    assert!(h.mkt.get_listing(&listing_id1).active);
    assert!(h.mkt.get_listing(&listing_id2).active);

    // First buyer purchases first bot
    h.mkt.buy_bot(&buyer1, &listing_id1);
    assert_eq!(h.bot.get_bot(&bot_id1).owner, buyer1);
    assert!(!h.mkt.get_listing(&listing_id1).active);

    // Second buyer purchases second bot
    h.mkt.buy_bot(&buyer2, &listing_id2);
    assert_eq!(h.bot.get_bot(&bot_id2).owner, buyer2);
    assert!(!h.mkt.get_listing(&listing_id2).active);

    // Verify seller received payment for both
    let fee = (price * 25) / 1000;
    let seller_receives_per_sale = price - fee;
    assert_eq!(h.token.balance(&seller), seller_receives_per_sale * 2);
}

// ── Issue #543: explicit authorization tests ──────────────────────────────
//
// `setup()` above uses `mock_all_auths()`, which makes every
// `require_auth()` call succeed unconditionally and therefore cannot catch a
// missing or incorrect auth check. Each test here exercises one
// `require_auth()` call site directly: the call must fail when the required
// signer has not authorized it, and succeed when that signer's authorization
// is explicitly mocked for exactly that invocation.
#[cfg(test)]
mod auth_tests {
    use super::*;
    use soroban_sdk::testutils::{MockAuth, MockAuthInvoke};
    use soroban_sdk::IntoVal;

    #[test]
    fn test_initialize_fails_without_admin_auth() {
        let h = setup();
        let mkt_id = h.env.register_contract(None, MarketplaceContract);
        let mkt = MarketplaceContractClient::new(&h.env, &mkt_id);
        let admin = Address::generate(&h.env);

        h.env.mock_auths(&[]);
        let result = mkt.try_initialize(&admin, &h.bot.address, &250u32);
        assert!(result.is_err());
    }

    #[test]
    fn test_initialize_succeeds_with_admin_auth() {
        let h = setup();
        let mkt_id = h.env.register_contract(None, MarketplaceContract);
        let mkt = MarketplaceContractClient::new(&h.env, &mkt_id);
        let admin = Address::generate(&h.env);

        h.env.mock_auths(&[MockAuth {
            address: &admin,
            invoke: &MockAuthInvoke {
                contract: &mkt_id,
                fn_name: "initialize",
                args: (admin.clone(), h.bot.address.clone(), 250u32).into_val(&h.env),
                sub_invokes: &[],
            },
        }]);
        let result = mkt.try_initialize(&admin, &h.bot.address, &250u32);
        assert!(result.is_ok());
    }

    #[test]
    fn test_list_bot_fails_without_seller_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);

        h.env.mock_auths(&[]);
        let result = h
            .mkt
            .try_list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);
        assert!(result.is_err());
    }

    #[test]
    fn test_list_bot_succeeds_with_seller_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);

        // `list_bot` escrows the bot via a cross-contract call into
        // `bot_nft.transfer(bot_id, seller, marketplace)`, which itself calls
        // `seller.require_auth()` — so the seller's authorization for the
        // root `list_bot` invocation must also cover that sub-invocation.
        h.env.mock_auths(&[MockAuth {
            address: &seller,
            invoke: &MockAuthInvoke {
                contract: &h.mkt.address,
                fn_name: "list_bot",
                args: (
                    seller.clone(),
                    bot_id,
                    50_0000000_i128,
                    h.token.address.clone(),
                )
                    .into_val(&h.env),
                sub_invokes: &[MockAuthInvoke {
                    contract: &h.bot.address,
                    fn_name: "transfer",
                    args: (bot_id, seller.clone(), h.mkt.address.clone()).into_val(&h.env),
                    sub_invokes: &[],
                }],
            },
        }]);
        let result = h
            .mkt
            .try_list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);
        assert!(result.is_ok());
    }

    #[test]
    fn test_cancel_listing_fails_without_seller_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        let listing_id = h
            .mkt
            .list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);

        h.env.mock_auths(&[]);
        let result = h.mkt.try_cancel_listing(&seller, &listing_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_cancel_listing_succeeds_with_seller_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let bot_id = h.bot.mint_basic(&seller);
        let listing_id = h
            .mkt
            .list_bot(&seller, &bot_id, &50_0000000_i128, &h.token.address);

        h.env.mock_auths(&[MockAuth {
            address: &seller,
            invoke: &MockAuthInvoke {
                contract: &h.mkt.address,
                fn_name: "cancel_listing",
                args: (seller.clone(), listing_id).into_val(&h.env),
                sub_invokes: &[],
            },
        }]);
        let result = h.mkt.try_cancel_listing(&seller, &listing_id);
        assert!(result.is_ok());
    }

    #[test]
    fn test_buy_bot_fails_without_buyer_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let buyer = Address::generate(&h.env);
        let price = 100_0000000_i128;
        h.token.mint(&buyer, &price);
        let bot_id = h.bot.mint_basic(&seller);
        let listing_id = h.mkt.list_bot(&seller, &bot_id, &price, &h.token.address);

        h.env.mock_auths(&[]);
        let result = h.mkt.try_buy_bot(&buyer, &listing_id);
        assert!(result.is_err());
    }

    #[test]
    fn test_buy_bot_succeeds_with_buyer_auth() {
        let h = setup();
        let seller = Address::generate(&h.env);
        let buyer = Address::generate(&h.env);
        let price = 100_0000000_i128;
        h.token.mint(&buyer, &price);
        let bot_id = h.bot.mint_basic(&seller);
        let listing_id = h.mkt.list_bot(&seller, &bot_id, &price, &h.token.address);

        // `buy_bot` pays the seller and the admin fee via cross-contract
        // calls into `token.transfer(buyer, ..., ...)`, which itself calls
        // `buyer.require_auth()` — so the buyer's authorization for the root
        // `buy_bot` invocation must also cover both payment sub-invocations.
        // (The bot transfer from the marketplace to the buyer is
        // self-authorized by the marketplace contract and needs no mock.)
        let fee = price * 25 / 1000;
        let seller_payment = price - fee;
        h.env.mock_auths(&[MockAuth {
            address: &buyer,
            invoke: &MockAuthInvoke {
                contract: &h.mkt.address,
                fn_name: "buy_bot",
                args: (buyer.clone(), listing_id).into_val(&h.env),
                sub_invokes: &[
                    MockAuthInvoke {
                        contract: &h.token.address,
                        fn_name: "transfer",
                        args: (buyer.clone(), seller.clone(), seller_payment).into_val(&h.env),
                        sub_invokes: &[],
                    },
                    MockAuthInvoke {
                        contract: &h.token.address,
                        fn_name: "transfer",
                        args: (buyer.clone(), h.admin.clone(), fee).into_val(&h.env),
                        sub_invokes: &[],
                    },
                ],
            },
        }]);
        let result = h.mkt.try_buy_bot(&buyer, &listing_id);
        assert!(result.is_ok());
    }
}
