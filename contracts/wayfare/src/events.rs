use near_sdk::json_types::{U128, U64};
use near_sdk::{near, AccountId};

#[near(event_json(standard = "wayfare"))]
pub enum Event {
    #[event_version("1.0.0")]
    MerchantAdded { merchant_id: String, category: String, network: String, pay_to: String },
    #[event_version("1.0.0")]
    MerchantUpdated { merchant_id: String, active: bool },
    #[event_version("1.0.0")]
    MerchantNetworkSet { merchant_id: String, network: String },
    #[event_version("1.0.0")]
    MerchantPayeeSet { merchant_id: String, network: String, pay_to: String },
    #[event_version("1.0.0")]
    NearWalletSet { traveler: AccountId, account_id: AccountId, path: String },
    #[event_version("1.0.0")]
    WalletSet { traveler: AccountId, address: String, path: String },
    #[event_version("1.0.0")]
    TripCreated { trip_id: U64, traveler: AccountId, agent: AccountId, plan_hash: String, budget: U128, items: u32, expires_at: U64 },
    #[event_version("1.0.0")]
    PaymentRequested { trip_id: U64, payment_id: U64, item: u32, merchant_id: String, amount: U128, digest: String },
    #[event_version("1.0.0")]
    PaymentSigned { trip_id: U64, payment_id: U64 },
    #[event_version("1.0.0")]
    PaymentFailed { trip_id: U64, payment_id: U64, reason: String },
    #[event_version("1.0.0")]
    PaymentRefused { trip_id: U64, item: u32, amount: U128, reason: String },
    #[event_version("1.0.0")]
    PaymentSettled { trip_id: U64, payment_id: U64, tx_hash: String },
    #[event_version("1.0.0")]
    VaultRead { trip_id: U64, read_id: U64, agent: AccountId, fields: Vec<String>, purpose: String },
    #[event_version("1.0.0")]
    TripEnded { trip_id: U64, spent: U128, unspent: U128 },
    #[event_version("1.0.0")]
    BookingCancelled { trip_id: U64, item: u32, payment_id: U64, merchant_id: String, refund: U128, refund_tx: String, rebook_max: U128 },
    #[event_version("1.0.0")]
    RebookApproved { trip_id: U64, item: u32, max: U128 },
}
