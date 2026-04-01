const mongoose = require('mongoose');
const crypto = require('crypto');

const passwordResetSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    index: true
  },
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  expiresAt: {
    type: Date,
    required: true,
    index: { expires: 0 }
  },
  used: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  collection: 'password_resets'
});

passwordResetSchema.statics.createToken = async function(username) {
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

  await this.deleteMany({ username, used: false });

  return this.create({ username, token, expiresAt });
};

passwordResetSchema.statics.verifyToken = async function(username, token) {
  const reset = await this.findOne({
    username,
    token,
    used: false,
    expiresAt: { $gt: new Date() }
  });

  if (!reset) return null;

  reset.used = true;
  await reset.save();

  return reset;
};

const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema);

module.exports = PasswordReset;
