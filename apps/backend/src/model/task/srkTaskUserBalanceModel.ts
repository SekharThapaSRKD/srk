import mongoose from 'mongoose';

const srkTaskUserBalanceSchema = new mongoose.Schema(
  {
    taskUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'srkTaskUser',
      required: true,
    },
    totalCoinsEarned: {
      type: Number,
      required: true,
      default: 0,
    },
    currentCoins: {
      type: Number,
      required: true,
      default: 0,
    },
    totalEarnings: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

srkTaskUserBalanceSchema.index({ taskUserId: 1 });

export const srkTaskUserBalanceModel = mongoose.model(
  'srkTaskUserBalance',
  srkTaskUserBalanceSchema
);
