import { TPaymentMethod, TPaymentType } from ".";

export type TPackage = {
  _id: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  discountedPrice: number;
  features: {
    text: string;
    included: boolean;
  }[]; // Assuming it's an array of strings, you can change it depending on your actual structure
  image?: string; // Optional field since it might not always be present
  createdAt?: Date; // This will be automatically managed by the `timestamps` option in the schema
  updatedAt?: Date; // This will be automatically managed as well
};

export type TUser = {
  _id: string;
  email: string;
  firstName: string;
  lastName: string;
  country: string;
  referralCode: string;
  profilePicture?: string;
  affiliateEnabled: boolean;
  allowedToAddUsers?: boolean;
  isActive: boolean;
  hasSrkBonusDeposited?: boolean;
  dob: string;
  gender: "Male" | "Female" | "Other";
  status:
    | "REGISTERED"
    | "PAYMENT_VERIFICATION_PENDING"
    | "PAYMENT_VERIFICATION_APPROVED"
    | "PAYMENT_VERIFICATION_REJECTED"
    | "KYC_VERIFICATION_REJECTED"
    | "KYC_VERIFICATION_PENDING"
    | "PORTAL_ACTIVATED"
    | "PORTAL_DEACTIVATED";
  purpose: "affiliate" | "study";
  phoneNumber: string;
  referredBy?: string;
  packageId: TPackage;
  createdAt?: Date; // This will be automatically managed by the `timestamps` option in the schema
  updatedAt?: Date; // This will be automatically managed as well
};

export type TBank = {
  userId: TUser;
  accountHolderName: string;
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  qrUrl: string;
  branchName: string;
  status: "pending" | "approved" | "rejected";
  accountType: string;
  rejectionReason?: string;
  relationWithAccount: string;
  createdAt: Date;
  updatedAt: Date;
};

export type TKyc = {
  userId: TUser;
  frontImage: string;
  backImage: string;
  documentType: string;
  documentNumber: string;
  status: "pending" | "approved" | "rejected"; // Use an enum for allowed statuses
  rejectionReason?: string;
  createdAt: Date;
  updatedAt: Date;
  verificationImage: string;
  leftThumbFingerprint?: string;
  rightThumbFingerprint?: string;
  signature?: string;
};

export type TCourse = {
  _id: string;
  title: string;
  description: string;
  image: string;
  package: TPackage[];
  createdAt: Date;
  updatedAt: Date;
};
export type TVideoRendition = {
  quality: string;
  url: string;
};
export type TCourseVideo = {
  _id: string;
  name: string;
  courseId: TCourse;
  videoUrl: string;
  duration: number;
  thumbnailUrl: string;
  createdAt: Date;
  updatedAt: Date;
  videoRenditions?: TVideoRendition[];
};

export type TAdminSrkBank = {
  amount: number;
  totalPendingPayout: number;
};

export type TCoursePayment = {
  transactionId?: string;
  paymentProofUrl?: string;
  paymentType?: TPaymentType;
  paymentMethod?: TPaymentMethod;
  rejectionReason?: string;
};

export type TWebinar = {
  _id: string;
  title: string;
  hasFinished: boolean;
  meetUrl?: string;
  youtubeUrl?: string;
  thumbnail?: string;
  createdAt?: Date; // This will be automatically managed by the `timestamps` option in the schema
  updatedAt?: Date; // This will be automatically managed as well
};

export type TTourTarget = {
  _id:string;
  destination: string;
  description: string;
  targetAmount: number;
  currentAmount: number;
  duration: number;
  accommodation: string;
  difficulty: "Easy" | "Medium" | "Hard";
  rating: number;
  image: string;
  features: string[];
  isActive: boolean;
  collectedAmount: number;
  createdAt: string;

};
