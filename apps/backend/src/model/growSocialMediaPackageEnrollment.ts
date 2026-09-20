import mongoose from 'mongoose';

export interface IGrowSocialMediaPackageEnrollment {
  growSocialMediaPackageUserId: mongoose.Types.ObjectId;
  growSocialMediaPackageId: mongoose.Types.ObjectId;
  growSocialMediaPackageTypeId: mongoose.Types.ObjectId;
  growSocialMediaPackageSubTypeId: mongoose.Types.ObjectId;
  socialMediaPlatform:
    | 'Instagram'
    | 'TikTok'
    | 'YouTube'
    | 'Twitter'
    | 'Facebook';
  profileLinkURL?: string[];
  amount: number;
  type: 'follow' | 'like';
  isActive?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const growSocialMediaPackageEnrollmentSchema =
  new mongoose.Schema<IGrowSocialMediaPackageEnrollment>(
    {
      growSocialMediaPackageUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'growSocialMediaPackageUser',
        required: true,
      },
      growSocialMediaPackageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'growSocialMediaPackage',
        required: true,
      },
      growSocialMediaPackageTypeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'growSocialMediaPackageType',
        required: true,
      },
      growSocialMediaPackageSubTypeId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'growSocialMediaPackageSubType',
        required: true,
      },
      type: {
        type: String,
        enum: ['follow', 'like'],
        required: true,
      },
      socialMediaPlatform: {
        type: String,
        enum: ['Instagram', 'TikTok', 'YouTube', 'Twitter', 'Facebook'],
        required: true,
      },
      profileLinkURL: {
        type: [String],
      },
      amount: {
        type: Number,
        requred: true,
      },
      isActive: {
        type: Boolean,
        default: false,
      },
    },
    {
      timestamps: true,
    }
  );

growSocialMediaPackageEnrollmentSchema.index({
  isActive: 1,
  type: 1,
  socialMediaPlatform: 1,
});

export const growSocialMediaPackageEnrollmentModel = mongoose.model(
  'growSocialMediaPackageEnrollment',
  growSocialMediaPackageEnrollmentSchema
);
