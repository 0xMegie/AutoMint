// SPDX-License-Identifier: Apache-2.0

#![no_std]
//! Marketplace contract for trading NFT bots.
//!
//! ## Events
//!
//! The marketplace emits the following events for auditing:
//! - `initialized`: Emitted when contract initializes.
//!   Topics: ("initialized",), Data: (admin, bot_nft, fee_recipient)
//! - `listed`: Emitted when a bot is listed for sale.
//!   Topics: ("listed", seller, listing_id), Data: (bot_id, price)
//! - `sold`: Emitted when a bot is purchased.
//!   Topics: ("sold", seller, buyer), Data: (listing_id, bot_id, price)
//! - `cancel`: Emitted when a listing is cancelled.
//!   Topics: ("cancel", seller, listing_id), Data: (bot_id,)
//! - `fee_bps_updated`: Emitted when fee basis points change.
//!   Topics: ("fee_bps_updated",), Data: (old_fee_bps, new_fee_bps)
//! - `fee_recipient_updated`: Emitted when fee recipient changes.
//!   Topics: ("fee_recipient_updated",), Data: (old_recipient, new_recipient)
//! - `bot_nft_updated`: Emitted when bot NFT address changes.
//!   Topics: ("bot_nft_updated",), Data: (old_nft, new_nft)
//! - `admin_updated`: Emitted when admin changes.
//!   Topics: ("admin_updated",), Data: (old_admin, new_admin)

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short, token, Address, Env, Vec,
};

use automint_bot_nft::{BotNFTContractClient, BotTier};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Listing(u64),
    ActiveListings,
    UserListings(Address),
    UserPurchases(Address),
    NextListingId,
    Config,
    Initialized,
}

#[derive(Clone, Debug, PartialEq)]
#[contracttype]
pub struct Listing {
    pub id: u64,
    pub seller: Address,
    pub bot_id: u64,
    pub bot_tier: BotTier,
    pub price: i128,
    pub currency: Address,
    pub listed_at: u64,
    pub active: bool,
}

#[derive(Clone, Debug)]
#[contracttype]
pub struct Purchase {
    pub listing_id: u64,
    pub bot_id: u64,
    pub seller: Address,
    pub price: i128,
    pub currency: Address,
    pub purchased_at: u64,
}

#[derive(Clone)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub bot_nft: Address,
    pub fee_bps: u32,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
pub enum MarketplaceError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidPrice = 3,
    BotTransferFailed = 4,
    ListingNotFound = 5,
    NotSeller = 6,
    ListingInactive = 7,
    InsufficientFunds = 8,
    ListingNotActive = 9,
    Unauthorized = 10,
    PaymentFailed = 11,
    Overflow = 12,
}

const LEDGER_BUMP: u32 = 120960;
const LEDGER_THRESHOLD: u32 = 103680;

#[contract]
pub struct MarketplaceContract;

#[contractimpl]
impl MarketplaceContract {
    /// Set the admin and bot_nft addresses. Fails with `AlreadyInitialized` if
    /// called twice.
    pub fn initialize(
        env: Env,
        admin: Address,
        bot_nft: Address,
        fee_bps: u32,
    ) -> Result<(), MarketplaceError> {
        if env.storage().instance().has(&DataKey::Initialized) {
            return Err(MarketplaceError::AlreadyInitialized);
        }
        admin.require_auth();
        let config = Config { bot_nft: bot_nft.clone(), admin: admin.clone(), fee_bps: FEE_BPS, fee_recipient: fee_recipient.clone() };
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().set(&DataKey::Initialized, &true);
        env.storage().instance().set(&DataKey::NextListingId, &1u64);
        env.storage().instance().set(&DataKey::ActiveListings, &Vec::<u64>::new(&env));
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            symbol_short!("initialized"),
            (admin, bot_nft, fee_recipient),
        );
        Ok(())
    }

    /// Escrow `bot_id` from `seller` into the marketplace contract, record a
    /// `Listing` at `price` in `currency`, and return the new listing ID.
    pub fn list_bot(
        env: Env,
        seller: Address,
        bot_id: u64,
        price: i128,
        currency: Address,
    ) -> Result<u64, MarketplaceError> {
        seller.require_auth();

        // A listing must have a strictly positive price.
        if price <= 0 {
            return Err(MarketplaceError::InvalidPrice);
        }

        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;

        // Fetch the bot's tier from the NFT contract.
        let bot_client = BotNFTContractClient::new(&env, &config.bot_nft);
        let bot = bot_client
            .try_get_bot(&bot_id)
            .map_err(|_| MarketplaceError::BotTransferFailed)?
            .map_err(|_| MarketplaceError::BotTransferFailed)?;
        let bot_tier = bot.tier;

        // Escrow the bot into the marketplace. The transfer fails (and we
        // surface BotTransferFailed instead of panicking) when the bot does not
        // exist or the seller is not its owner.
        let marketplace = env.current_contract_address();
        if bot_client
            .try_transfer(&bot_id, &seller, &marketplace)
            .is_err()
        {
            return Err(MarketplaceError::BotTransferFailed);
        }

        let listing_id: u64 = env
            .storage()
            .instance()
            .get(&DataKey::NextListingId)
            .unwrap_or(1);

        let listing = Listing {
            id: listing_id,
            seller: seller.clone(),
            bot_id,
            bot_tier,
            price,
            currency,
            listed_at: env.ledger().timestamp(),
            active: true,
        };
        env.storage()
            .persistent()
            .set(&DataKey::Listing(listing_id), &listing);
        env.storage().persistent().extend_ttl(
            &DataKey::Listing(listing_id),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        let mut active: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveListings)
            .unwrap_or_else(|| Vec::new(&env));
        active.push_back(listing_id);
        env.storage()
            .instance()
            .set(&DataKey::ActiveListings, &active);

        let mut user_listings: Vec<u64> = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::UserListings(seller.clone()))
            .unwrap_or_else(|| Vec::new(&env));
        user_listings.push_back(listing_id);
        env.storage()
            .persistent()
            .set(&DataKey::UserListings(seller.clone()), &user_listings);

        env.storage()
            .instance()
            .set(&DataKey::NextListingId, &(listing_id + 1));
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events().publish(
            (symbol_short!("listed"), seller, listing_id),
            (bot_id, price),
        );
        Ok(listing_id)
    }

    pub fn buy_bot(env: Env, buyer: Address, listing_id: u64) -> Result<(), MarketplaceError> {
        buyer.require_auth();
        let mut listing: Listing = env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .ok_or(MarketplaceError::ListingNotFound)?;
        if !listing.active {
            return Err(MarketplaceError::ListingInactive);
        }
        if listing.seller == buyer {
            return Err(MarketplaceError::SelfPurchase);
        }
        let config: Config = env.storage().instance().get(&DataKey::Config).unwrap();
        let marketplace = env.current_contract_address();
        let fee = listing.price * (config.fee_bps as i128) / 10_000;
        let seller_amount = listing.price - fee;
        let token = TokenClient::new(&env, &listing.currency);
        token.transfer(&buyer, &listing.seller, &seller_amount);
        if fee > 0 {
            token.transfer(&buyer, &config.fee_recipient, &fee);
        }
        call_bot_transfer(&env, &config.bot_nft, &marketplace, &buyer, listing.bot_id);
        listing.active = false;
        env.storage().persistent().set(&DataKey::Listing(listing_id), &listing);
        Self::remove_active_listing(&env, listing_id);
        let purchase = Purchase {
            listing_id,
            bot_id: listing.bot_id,
            seller: listing.seller.clone(),
            price: listing.price,
            currency: listing.currency,
            purchased_at: env.ledger().timestamp(),
        };
        Self::add_user_purchase(&env, &buyer, purchase);
        env.events().publish(
            (symbol_short!("sold"), listing.seller.clone(), buyer.clone()),
            (listing_id, listing.bot_id, listing.price),
        );
        Ok(())
    }

    pub fn cancel_listing(
        env: Env,
        seller: Address,
        listing_id: u64,
    ) -> Result<(), MarketplaceError> {
        seller.require_auth();

        let mut listing: Listing = env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .ok_or(MarketplaceError::ListingNotFound)?;

        if !listing.active {
            return Err(MarketplaceError::ListingNotActive);
        }

        if listing.seller != seller {
            return Err(MarketplaceError::Unauthorized);
        }

        let config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;

        // Return the escrowed bot from the marketplace back to the seller.
        let marketplace = env.current_contract_address();
        let bot_client = BotNFTContractClient::new(&env, &config.bot_nft);
        if bot_client
            .try_transfer(&listing.bot_id, &marketplace, &seller)
            .is_err()
        {
            return Err(MarketplaceError::BotTransferFailed);
        }

        // Mark listing inactive and persist.
        listing.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Listing(listing_id), &listing);
        env.storage().persistent().extend_ttl(
            &DataKey::Listing(listing_id),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );

        // Remove from the active listings index.
        let active: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveListings)
            .unwrap_or_else(|| Vec::new(&env));
        let mut new_active: Vec<u64> = Vec::new(&env);
        for id in active.iter() {
            if id != listing_id {
                new_active.push_back(id);
            }
        }
        env.storage()
            .instance()
            .set(&DataKey::ActiveListings, &new_active);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events().publish(
            (symbol_short!("cancelled"), seller, listing_id),
            listing.bot_id,
        );
        Ok(())
    }

    pub fn get_listing(env: Env, listing_id: u64) -> Result<Listing, MarketplaceError> {
        env.storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .ok_or(MarketplaceError::ListingNotFound)
    }

    /// Return up to `limit` active listings, skipping the first `start` entries
    /// of the active-listings index.
    ///
    /// Input validation / edge-case handling (issue #120):
    /// - `limit == 0`: a request for zero items is trivially satisfied, so we
    ///   return an empty vec immediately rather than treating it as an error.
    /// - `start` beyond the number of active listings: the index iteration
    ///   simply skips every entry and yields an empty vec — no panic.
    /// - Stale index entry (an id in `ActiveListings` whose `Listing(id)` record
    ///   was removed from persistent storage): skipped gracefully via the
    ///   `if let Some(l)` guard.
    /// - An id still present in the index but whose listing has `active == false`:
    ///   filtered out by the `if l.active` check.
    ///
    /// Every edge case degrades gracefully to an empty/partial result, so there
    /// is no genuine failure condition to signal. The return type stays
    /// `Vec<Listing>` (rather than `Result<..>`) to avoid needless API churn for
    /// callers.
    pub fn get_active_listings(env: Env, start: u64, limit: u32) -> Vec<Listing> {
        let mut result: Vec<Listing> = Vec::new(&env);
        // A request for zero items is trivially satisfied with an empty vec.
        if limit == 0 {
            return result;
        }
        let active_ids: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveListings)
            .unwrap_or_else(|| Vec::new(&env));
        let mut count: u32 = 0;
        for (i, id) in active_ids.iter().enumerate() {
            if (i as u64) < start {
                continue;
            }
            if count >= limit {
                break;
            }
            if let Some(l) = env
                .storage()
                .persistent()
                .get::<_, Listing>(&DataKey::Listing(id))
            {
                if l.active {
                    result.push_back(l);
                    count += 1;
                }
            }
        }
        result
    }

    pub fn get_user_listings(env: Env, seller: Address) -> Vec<Listing> {
        let ids: Vec<u64> = env
            .storage()
            .persistent()
            .get::<_, Vec<u64>>(&DataKey::UserListings(seller))
            .unwrap_or_else(|| Vec::new(&env));
        let mut result: Vec<Listing> = Vec::new(&env);
        for id in ids.iter() {
            if let Some(l) = env
                .storage()
                .persistent()
                .get::<_, Listing>(&DataKey::Listing(id))
            {
                result.push_back(l);
            }
        }
        result
    }

    pub fn get_user_purchases(env: Env, buyer: Address, limit: u32) -> Vec<Purchase> {
        let purchases: Vec<Purchase> = env
            .storage()
            .persistent()
            .get::<_, Vec<Purchase>>(&DataKey::UserPurchases(buyer))
            .unwrap_or_else(|| Vec::new(&env));
        let mut result: Vec<Purchase> = Vec::new(&env);
        let start = if purchases.len() > limit as usize {
            purchases.len() - (limit as usize)
        } else {
            0
        };
        for i in start..purchases.len() {
            result.push_back(purchases.get(i as u32).unwrap().clone());
        }
        result
    }

    pub fn config(env: Env) -> Config {
        env.storage().instance().get(&DataKey::Config).unwrap()
    }

    pub fn set_fee_bps(env: Env, new_fee_bps: u32) -> Result<(), MarketplaceError> {
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();
        let old_fee_bps = config.fee_bps;
        config.fee_bps = new_fee_bps;
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            symbol_short!("fee_bps_updated"),
            (old_fee_bps, new_fee_bps),
        );
        Ok(())
    }

    pub fn set_fee_recipient(env: Env, new_recipient: Address) -> Result<(), MarketplaceError> {
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();
        let old_recipient = config.fee_recipient.clone();
        config.fee_recipient = new_recipient;
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            symbol_short!("fee_recipient_updated"),
            (old_recipient, config.fee_recipient.clone()),
        );
        Ok(())
    }

    pub fn set_bot_nft(env: Env, new_bot_nft: Address) -> Result<(), MarketplaceError> {
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();
        let old_nft = config.bot_nft.clone();
        config.bot_nft = new_bot_nft;
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            symbol_short!("bot_nft_updated"),
            (old_nft, config.bot_nft.clone()),
        );
        Ok(())
    }

    pub fn set_admin(env: Env, new_admin: Address) -> Result<(), MarketplaceError> {
        let mut config: Config = env
            .storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(MarketplaceError::NotInitialized)?;
        config.admin.require_auth();
        let old_admin = config.admin.clone();
        config.admin = new_admin;
        env.storage().instance().set(&DataKey::Config, &config);
        env.storage().instance().extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);
        env.events().publish(
            symbol_short!("admin_updated"),
            (old_admin, config.admin.clone()),
        );
        Ok(())
    }

    fn remove_active_listing(env: &Env, listing_id: u64) {
        let active: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveListings)
            .unwrap_or_else(|| Vec::new(env));
        let mut new_active: Vec<u64> = Vec::new(env);
        for id in active.iter() {
            if id != listing_id {
                new_active.push_back(id);
            }
        }
        env.storage().instance().set(&DataKey::ActiveListings, &new_active);
    }

    fn add_user_purchase(env: &Env, buyer: &Address, purchase: Purchase) {
        let mut purchases: Vec<Purchase> = env
            .storage()
            .persistent()
            .get::<_, Vec<Purchase>>(&DataKey::UserPurchases(buyer.clone()))
            .unwrap_or_else(|| Vec::new(env));
        purchases.push_back(purchase);
        env.storage().persistent().set(&DataKey::UserPurchases(buyer.clone()), &purchases);
        env.storage().persistent().extend_ttl(
            &DataKey::UserPurchases(buyer.clone()),
            LEDGER_THRESHOLD,
            LEDGER_BUMP,
        );
    }
}

        let mut listing: Listing = env
            .storage()
            .persistent()
            .get(&DataKey::Listing(listing_id))
            .ok_or(MarketplaceError::ListingNotFound)?;

        if !listing.active {
            return Err(MarketplaceError::ListingNotActive);
        }

    #[test]
    fn test_buy_bot() {
        let env = Env::default();
        let (admin, bot, tok, mkt) = setup(&env);
        let seller = Address::generate(&env);
        let buyer = Address::generate(&env);
        tok.mint(&buyer, &1000_0000000_i128);
        let bot_nft_id = bot.mint_basic(&seller).unwrap();
        mkt.list_bot(&seller, &bot_nft_id, &0u32, &100_0000000_i128, &tok.address).unwrap();
        mkt.buy_bot(&buyer, &1u64).unwrap();
        assert_eq!(bot.get_user_bots(&buyer).len(), 1);
        assert_eq!(bot.get_user_bots(&seller).len(), 0);
        let fee = 100_0000000_i128 * 250 / 10_000;
        assert_eq!(tok.balance(&admin), fee);
        assert_eq!(tok.balance(&seller), 100_0000000_i128 - fee);
    }

        // 2.5% fee (250 basis points), guarded against overflow instead of
        // panicking on an extreme listing price.
        let fee = listing
            .price
            .checked_mul(25)
            .and_then(|v| v.checked_div(1000))
            .ok_or(MarketplaceError::Overflow)?;
        let seller_payment = listing
            .price
            .checked_sub(fee)
            .ok_or(MarketplaceError::Overflow)?;

        // Transfer bot NFT first (most critical asset). If this succeeds but
        // payment fails, buyer has the bot. This is preferable to buyer sending
        // payment but not receiving the bot (payment is reversible via governance,
        // NFT transfer is not).
        let marketplace = env.current_contract_address();
        let bot_client = BotNFTContractClient::new(&env, &config.bot_nft);
        if bot_client
            .try_transfer(&listing.bot_id, &marketplace, &buyer)
            .is_err()
        {
            return Err(MarketplaceError::BotTransferFailed);
        }

        // Now handle payment transfers. Fee transfer failure is swallowed to avoid
        // aborting the entire purchase if only the admin fee fails.
        let token_client = token::Client::new(&env, &listing.currency);
        if token_client
            .try_transfer(&buyer, &listing.seller, &seller_payment)
            .is_err()
        {
            return Err(MarketplaceError::PaymentFailed);
        }
        if fee > 0 {
            let _ = token_client.try_transfer(&buyer, &config.admin, &fee);
        }

        listing.active = false;
        env.storage()
            .persistent()
            .set(&DataKey::Listing(listing_id), &listing);

        let mut active: Vec<u64> = env
            .storage()
            .instance()
            .get(&DataKey::ActiveListings)
            .unwrap_or_else(|| Vec::new(&env));
        let mut new_active: Vec<u64> = Vec::new(&env);
        for id in active.iter() {
            if id != listing_id {
                new_active.push_back(id);
            }
        }
        active = new_active;
        env.storage()
            .instance()
            .set(&DataKey::ActiveListings, &active);
        env.storage()
            .instance()
            .extend_ttl(LEDGER_THRESHOLD, LEDGER_BUMP);

        env.events().publish(
            (symbol_short!("bought"), buyer, listing_id),
            (listing.bot_id, listing.price),
        );
        Ok(())
    }

    #[test]
    fn test_initialize_emits_event() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let bot_nft_addr = env.register_contract(None, BotNFTContract);
        let mkt_id = env.register_contract(None, MarketplaceContract);
        let mkt = MarketplaceContractClient::new(&env, &mkt_id);
        mkt.initialize(&admin, &bot_nft_addr, &admin);
        let events = env.events().all();
        assert!(events.len() >= 1);
        let init_event = events.last().unwrap();
        assert_eq!(init_event.0.get_unchecked(0), &symbol_short!("initialized").into_val(&env));
    }

    #[test]
    fn test_user_purchase_history() {
        let env = Env::default();
        let (_, bot, tok, mkt) = setup(&env);
        let seller = Address::generate(&env);
        let buyer = Address::generate(&env);
        tok.mint(&buyer, &1000_0000000_i128);
        let bot_id = bot.mint_basic(&seller).unwrap();
        mkt.list_bot(&seller, &bot_id, &0u32, &100_0000000_i128, &tok.address).unwrap();
        mkt.buy_bot(&buyer, &1u64).unwrap();
        let purchases = mkt.get_user_purchases(&buyer, &10u32);
        assert_eq!(purchases.len(), 1);
        let purchase = purchases.get(0).unwrap();
        assert_eq!(purchase.listing_id, 1);
        assert_eq!(purchase.bot_id, bot_id);
        assert_eq!(purchase.seller, seller);
        assert_eq!(purchase.price, 100_0000000_i128);
    }

    #[test]
    fn test_bounded_purchase_history() {
        let env = Env::default();
        let (_, bot, tok, mkt) = setup(&env);
        let seller = Address::generate(&env);
        let buyer = Address::generate(&env);
        tok.mint(&buyer, &10000_0000000_i128);
        for i in 0u32..15 {
            let bot_id = bot.mint_basic(&seller).unwrap();
            mkt.list_bot(&seller, &bot_id, &0u32, &100_0000000_i128, &tok.address).unwrap();
            mkt.buy_bot(&buyer, &(i as u64 + 1)).unwrap();
        }
        let all_purchases = mkt.get_user_purchases(&buyer, &100u32);
        assert_eq!(all_purchases.len(), 15);
        let limited_purchases = mkt.get_user_purchases(&buyer, &5u32);
        assert_eq!(limited_purchases.len(), 5);
        let last_purchase = limited_purchases.get(4).unwrap();
        assert_eq!(last_purchase.listing_id, 15);
    }

    #[test]
    fn test_empty_purchase_history() {
        let env = Env::default();
        let (_, _, _, mkt) = setup(&env);
        let buyer = Address::generate(&env);
        let purchases = mkt.get_user_purchases(&buyer, &10u32);
        assert_eq!(purchases.len(), 0);
    }

    #[test]
    fn test_set_fee_bps_emits_event() {
        let env = Env::default();
        let (_, _, _, mkt) = setup(&env);
        let old_count = env.events().all().len();
        mkt.set_fee_bps(&500u32).unwrap();
        let events = env.events().all();
        assert!(events.len() > old_count);
        let config = mkt.config();
        assert_eq!(config.fee_bps, 500);
    }

    #[test]
    fn test_set_fee_recipient_emits_event() {
        let env = Env::default();
        let (_, _, _, mkt) = setup(&env);
        let new_recipient = Address::generate(&env);
        mkt.set_fee_recipient(&new_recipient).unwrap();
        let config = mkt.config();
        assert_eq!(config.fee_recipient, new_recipient);
    }

    #[test]
    fn test_set_bot_nft_emits_event() {
        let env = Env::default();
        let (_, _, _, mkt) = setup(&env);
        let new_nft = Address::generate(&env);
        mkt.set_bot_nft(&new_nft).unwrap();
        let config = mkt.config();
        assert_eq!(config.bot_nft, new_nft);
    }

    #[test]
    fn test_set_admin_emits_event() {
        let env = Env::default();
        let (admin, _, _, mkt) = setup(&env);
        let new_admin = Address::generate(&env);
        mkt.set_admin(&new_admin).unwrap();
        let config = mkt.config();
        assert_eq!(config.admin, new_admin);
    }

    #[test]
    fn test_unauthorized_set_fee_bps_fails() {
        let env = Env::default();
        let (_, _, _, mkt) = setup(&env);
        env.mock_all_auths_allowing_non_root_auth();
        assert!(mkt.try_set_fee_bps(&500u32).is_err());
    }
}

#[cfg(test)]
mod test;
