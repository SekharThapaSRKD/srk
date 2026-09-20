import mongoose from 'mongoose';

const srkTaskEarningStatementSchema = new mongoose.Schema(
  {
    taskUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'srkTaskUser',
      required: true,
    },
    taskActionSubmissionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'srkTaskActionSubmission',
    },
    growPackageTodoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'growPackageTodo',
    },
    description: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: true,
    },
    coin: {
      type: Number,
    },
    coinAfterTransaction: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

srkTaskEarningStatementSchema.index({ taskUserId: 1, createdAt: -1 });

export const srkTaskEarningStatementModel = mongoose.model(
  'srkTaskEarningStatement',
  srkTaskEarningStatementSchema
);
