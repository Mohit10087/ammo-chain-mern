const mongoose = require('mongoose');

// Each document is one block in an append-only, hash-linked ledger.
// This plays the role Hyperledger Fabric's ordered transaction log + history
// API would have played in the original design: every state change is
// recorded here first, in order, and never mutated afterwards. Integrity is
// verifiable by anyone by recomputing hashes end-to-end (see
// blockchain/Ledger.js#verifyChain).
const blockSchema = new mongoose.Schema(
  {
    index: { type: Number, required: true, unique: true },
    timestamp: { type: Date, required: true },

    // The chaincode-equivalent "transaction type"
    txType: {
      type: String,
      required: true,
      enum: [
        'REGISTER_LOT',
        'ISSUE_LOT',
        'TRANSFER_LOT',
        'RECORD_CONSUMPTION',
        'DISPOSE_LOT',
        'UPDATE_STORAGE_CONDITION',
        'FLAG_FOR_INSPECTION',
        'CREATE_REQUISITION',
        'APPROVE_REQUISITION',
        'ANOMALY_FLAGGED'
      ]
    },

    lotID: { type: String, default: null, index: true },

    // Arbitrary payload for the transaction (kept flexible on purpose -
    // equivalent to chaincode function arguments + resulting state delta)
    payload: { type: mongoose.Schema.Types.Mixed, required: true },

    submittedByOrg: { type: String, required: true },
    submittedByUser: { type: String, required: true },

    previousHash: { type: String, required: true },
    hash: { type: String, required: true }
  },
  { timestamps: false }
);

module.exports = mongoose.model('Block', blockSchema);
