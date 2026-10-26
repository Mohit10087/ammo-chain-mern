const mongoose = require('mongoose');

// ORG mirrors the Fabric organizations from the original design
// (OrdnanceFactory, Depot, FieldUnit) plus a cross-org read-only Commander.
const ORGS = ['OrdnanceFactory', 'Depot', 'FieldUnit', 'Commander'];

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true },
    passwordHash: { type: String, required: true },
    org: { type: String, enum: ORGS, required: true },
    // Human-facing job title, does not affect access control by itself.
    displayName: { type: String, required: true },
    // Only meaningful for org === 'Depot': which depot this user acts for.
    depotId: { type: String, default: null }
  },
  { timestamps: true }
);

userSchema.methods.toSafeJSON = function () {
  return {
    id: this._id,
    username: this.username,
    org: this.org,
    displayName: this.displayName,
    depotId: this.depotId
  };
};

module.exports = mongoose.model('User', userSchema);
module.exports.ORGS = ORGS;
