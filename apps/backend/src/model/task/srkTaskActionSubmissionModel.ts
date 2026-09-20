import mongoose from 'mongoose';

const srkTaskActionSubmissionSchema = new mongoose.Schema(
  {
    taskUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'srkTaskUser',
      required: true,
    },
    growPackageTodoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'growPackageTodo',
      required: true,
    },
    type: {
      type: String,
      enum: ['follow', 'like'],
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    screenshotUrl: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'claimed', 'rejected'],
      default: 'pending',
      required: true,
    },
    hasClaimedEarning: {
      type: Boolean,
      default: false,
    },
    rejectionReason: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

// Every task-app request filters by user and/or status; without these the
// collection (growing ~10k docs/day) is scanned in full on each call.
srkTaskActionSubmissionSchema.index({
  taskUserId: 1,
  status: 1,
  createdAt: -1,
});
srkTaskActionSubmissionSchema.index({ taskUserId: 1, growPackageTodoId: 1 });
srkTaskActionSubmissionSchema.index({ status: 1, createdAt: -1 });

export const srkTaskActionSubmissionModel = mongoose.model(
  'srkTaskActionSubmission',
  srkTaskActionSubmissionSchema
);
