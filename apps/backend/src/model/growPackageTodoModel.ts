import mongoose from 'mongoose';

export interface IGrowPackageEngagementPost {
  growSocialMediaPackageEnrollmentId: mongoose.Types.ObjectId;
  postUrl: string;
  profileUrl: string;
  type: 'follow' | 'like';
  followCounts: number;
  likeCounts: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const growPackageTodoSchema = new mongoose.Schema(
  {
    growSocialMediaPackageEnrollmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'growSocialMediaPackageEnrollment',
      required: true,
    },
    postUrl: { type: String },
    profileUrl: { type: String },
    type: {
      type: String,
      enum: ['follow', 'like'],
      required: true,
    },
    platform: {
      type: String,
      enum: ['Instagram', 'TikTok', 'YouTube', 'Twitter', 'Facebook'],
      required: true,
    },
    followCounts: { type: Number, default: 0 },
    likeCounts: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

growPackageTodoSchema.index({ growSocialMediaPackageEnrollmentId: 1 });

export const growPackageTodoModel = mongoose.model(
  'growPackageTodo',
  growPackageTodoSchema
);
