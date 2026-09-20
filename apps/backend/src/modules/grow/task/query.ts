import mongoose from 'mongoose';
import {
  srkTaskContract,
} from '@srk/shared/contracts';
import { AppRouteImplementationOrOptions } from '@ts-rest/express/src/lib/types';
import { srkTaskUserModel } from '../../../model/task/srkTaskUserModel';
import { srkTaskActionSubmissionModel } from '../../../model/task/srkTaskActionSubmissionModel';
import { srkTaskEarningStatementModel } from '../../../model/task/srkTaskEarningStatementModel';
import { srkTasksEarningsPayoutModel } from '../../../model/task/srkTasksEarningsPayoutModel';
import { srkTaskOnboardingVerificationRequestModel } from '../../../model/task/srkTaskOnboardingVerificationRequestModel';
import { IUser } from '../../../model/userModel';
import { srkTaskUserBalanceModel } from '../../../model/task/srkTaskUserBalanceModel';
import { growPackageTodoModel } from '../../../model/growPackageTodoModel';
import { growSocialMediaPackageEnrollmentModel } from '../../../model/growSocialMediaPackageEnrollment';
import { srkTaskUserPaymentDetailsRequestModel } from '../../../model/task/srkTaskUserPaymentDetailsRequestModel';

const getAllSrkTasksActionSubmissionByStatusForAdmin: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getAllSrkTasksActionSubmissionByStatusForAdmin
> = async ({ query }) => {
  try {
    const page = query?.page ? Number(query.page) : 1;
    const limit = query?.limit ? Number(query.limit) : 10;
    const skip = (page - 1) * limit;
    const status = query?.status || 'pending';

    // We use aggregation to group pending submissions by taskUserId
    // This ensures that the admin sees a list of unique users who have pending submissions
    const aggregationResults = await srkTaskActionSubmissionModel.aggregate([
      { $match: { status } },
      {
        $group: {
          _id: '$taskUserId',
          latestSubmissionAt: { $max: '$createdAt' },
          pendingCount: { $sum: 1 },
          submissionId: { $first: '$_id' }
        },
      },
      {
        $lookup: {
          from: 'srktaskusers',
          localField: '_id',
          foreignField: '_id',
          as: 'userDetails'
        }
      },
      { $match: { 'userDetails.0': { $exists: true } } },
      { $sort: { latestSubmissionAt: -1 } },
      {
        $facet: {
          metadata: [{ $count: 'total' }],
          totalSubmissionsCount: [
            { $group: { _id: null, total: { $sum: "$pendingCount" } } }
          ],
          data: [{ $skip: skip }, { $limit: limit }],
        },
      },
    ]);

    const totalRecords = aggregationResults[0].metadata[0]?.total || 0;
    const globalPendingCount = aggregationResults[0].totalSubmissionsCount[0]?.total || 0;
    const userGroups = aggregationResults[0].data;

    const data = await Promise.all(
      userGroups.map(async (group: any) => {
        // Fetch the corresponding task user with populated fields
        const taskUser: any = await srkTaskUserModel
          .findById(group._id)
          .populate({
            path: 'srkUniversityUserId',
            select: 'fullName email phoneNumber packageId',
            populate: {
              path: 'packageId',
              select: 'title',
            },
          })
          .lean();

        if (!taskUser) return null;

        // Get lifetime statistics for this user
        const [approvedCount, totalSubmissions, balance] = await Promise.all([
          srkTaskActionSubmissionModel.countDocuments({
            taskUserId: taskUser._id,
            status: 'approved',
          }),
          srkTaskActionSubmissionModel.countDocuments({
            taskUserId: taskUser._id,
          }),
          srkTaskUserBalanceModel
            .findOne({
              $or: [
                { taskUserId: taskUser._id },
                { taskUserId: taskUser._id.toString() },
              ],
            })
            .lean(),
        ]);

        return {
          _id: group.submissionId.toString(), // Returning a reference submission ID for UI compatibility
          status: status,
          taskUserId: {
            _id: taskUser._id.toString(),
            fullName:
              taskUser.srkUniversityUserId?.fullName ||
              taskUser.fullName ||
              'N/A',
            email: taskUser.srkUniversityUserId?.email || 'N/A',
            phoneNumber: taskUser.srkUniversityUserId?.phoneNumber || 'N/A',
            packageName:
              taskUser.srkUniversityUserId?.packageId?.title || 'SRK Basic',
            approvedCount,
            totalSubmissions,
            currentCoins: balance?.currentCoins || 0,
            totalCoinsEarned: balance?.totalCoinsEarned || 0,
          },
          pendingCount: group.pendingCount,
          createdAt: group.latestSubmissionAt?.toISOString() || '',
        };
      })
    );

    const totalRecordsResult = data.filter(Boolean);

    return {
      status: 200,
      body: {
        page,
        limit,
        totalRecords,
        totalSubmissionsCount: globalPendingCount,
        totalPages: Math.ceil(totalRecords / limit),
        data: totalRecordsResult,
      },
    };
  } catch (error) {
    console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return {
        status: 500,
        body: {
          success: false,
          message: errorMessage,
        },
      };
  }
};
const getSrkTaskUserProfile: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getSrkTaskUserProfile
> = async ({ params }) => {
  try {
    const { userId } = params;
    const taskUserId = new mongoose.Types.ObjectId(userId);

    // Populate university user
    const profile = await srkTaskUserModel
      .findById(taskUserId)
      .populate<{ srkUniversityUserId: IUser }>('srkUniversityUserId')
      .lean();

    if (!profile) {
      return {
        status: 404,
        body: {
          message: 'SRK Task user not found',
          success: false,
        },
      };
    }

    const totalTasksCompleted =
      await srkTaskActionSubmissionModel.countDocuments({
        taskUserId,
        status: 'approved',
      });

    const totalCoinsEarnedAgg = await srkTaskEarningStatementModel.aggregate([
      {
        $match: {
          taskUserId,
          type: 'credit',
        },
      },
      {
        $group: {
          _id: null,
          totalCoins: {
            $sum: '$coin',
          },
        },
      },
    ]);
    const totalCoinsEarned = totalCoinsEarnedAgg[0]?.totalCoins ?? 0;

    const totalEarningsAgg = await srkTasksEarningsPayoutModel.aggregate([
      {
        $match: {
          taskUserId,
          status: 'approved',
        },
      },
      {
        $group: {
          _id: null,
          totalEarnings: {
            $sum: '$amount',
          },
        },
      },
    ]);
    const totalEarnings = totalEarningsAgg[0]?.totalEarnings ?? 0;

    const latestKyc = await srkTaskOnboardingVerificationRequestModel
      .findOne({ taskUserId })
      .sort({ createdAt: -1 })
      .lean();

    const daysSinceJoin = Math.max(
      Math.floor(
        (Date.now() - new Date(profile.createdAt).getTime()) /
          (1000 * 60 * 60 * 24)
      ),
      1
    );

    const totalTasksSubmitted =
      await srkTaskActionSubmissionModel.countDocuments({
        taskUserId,
      });

    const successRate =
      totalTasksSubmitted > 0
        ? (totalTasksCompleted / totalTasksSubmitted) * 100
        : 0;

    return {
      status: 200,
      body: {
        userData: {
          _id: profile._id.toString(),
          srkUniversityUserId: profile.srkUniversityUserId._id.toString(),
          fullName: profile.fullName,
          phone: profile.srkUniversityUserId.phoneNumber,
          email: profile.srkUniversityUserId.email,
          isActivated: profile.isActivated,
          kycStatus: latestKyc?.status ?? 'pending',
          createdAt: profile.createdAt.toLocaleString(),
        },
        taskData: {
          totalTasksCompleted,
          totalCoinsEarned,
          totalEarnings,
          avgDailyEarn: totalCoinsEarned / daysSinceJoin,
          successRate,
        },
      },
    };
  } catch (error) {
    console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return {
        status: 500,
        body: {
          success: false,
          message: `Internal server error: ${errorMessage}`,
        },
      };
  }
};

const getSrkTaskUserAnalytics: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getSrkTaskUserAnalytics
> = async ({ params }) => {
  try {
    const { userId } = params;

    const taskUserId = new mongoose.Types.ObjectId(userId);

    const profile = await srkTaskUserModel.findById(taskUserId).lean();
    if (!profile) {
      return {
        status: 404,
        body: {
          message: 'User not found',
          success: false,
        },
      };
    }

    const now = new Date();
    const startOfToday = new Date(now.setHours(0, 0, 0, 0));

    const coinEarningStats = await srkTaskEarningStatementModel.aggregate([
      {
        $match: {
          taskUserId,
          type: 'credit',
        },
      },
      // Sum total/all-time, today, last7, last28
      {
        $group: {
          _id: null,
          allTimeCoins: {
            $sum: '$coin',
          },
          today: {
            $sum: {
              $cond: [
                {
                  $gte: ['$createdAt', startOfToday],
                },
                '$coin',
                0,
              ],
            },
          },
          yesterday: {
            $sum: {
              $cond: [
                {
                  $and: [
                    {
                      $gte: [
                        '$createdAt',
                        new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000),
                      ],
                    },
                    { $lt: ['$createdAt', startOfToday] },
                  ],
                },
                '$coin',
                0,
              ],
            },
          },
          last7Days: {
            $sum: {
              $cond: [
                {
                  $gte: [
                    '$createdAt',
                    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                  ],
                },
                '$coin',
                0,
              ],
            },
          },
          prev7Days: {
            $sum: {
              $cond: [
                {
                  $and: [
                    {
                      $gte: [
                        '$createdAt',
                        new Date(Date.now() - 14 * 24 * 60 * 60 * 1000),
                      ],
                    },
                    {
                      $lt: [
                        '$createdAt',
                        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
                      ],
                    },
                  ],
                },
                '$coin',
                0,
              ],
            },
          },
          last28Days: {
            $sum: {
              $cond: [
                {
                  $gte: [
                    '$createdAt',
                    new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
                  ],
                },
                '$coin',
                0,
              ],
            },
          },
          prev28Days: {
            $sum: {
              $cond: [
                {
                  $and: [
                    {
                      $gte: [
                        '$createdAt',
                        new Date(Date.now() - 56 * 24 * 60 * 60 * 1000),
                      ],
                    },
                    {
                      $lt: [
                        '$createdAt',
                        new Date(Date.now() - 28 * 24 * 60 * 60 * 1000),
                      ],
                    },
                  ],
                },
                '$coin',
                0,
              ],
            },
          },
        },
      },
    ]);

    const coinStats = coinEarningStats[0] ?? {};

    const peakDayCoinsAgg = await srkTaskEarningStatementModel.aggregate([
      {
        $match: {
          taskUserId,
          type: 'credit',
        },
      },
      {
        $group: {
          _id: {
            year: {
              $year: '$createdAt',
            },
            month: {
              $month: '$createdAt',
            },
            day: {
              $dayOfMonth: '$createdAt',
            },
          },
          dailyCoins: {
            $sum: '$coin',
          },
        },
      },
      { $sort: { dailyCoins: -1 } },
      { $limit: 1 },
    ]);

    const peakDayCoins = peakDayCoinsAgg[0]?.dailyCoins ?? 0;

    // Task stats aggregation
    const taskStatsAgg = await srkTaskActionSubmissionModel.aggregate([
      {
        $match: {
          taskUserId,
        },
      },
      {
        $group: {
          _id: null,
          totalTasks: {
            $sum: 1,
          },
          completedTasks: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, 1, 0],
            },
          },
        },
      },
    ]);

    const taskStats = taskStatsAgg[0] ?? { totalTasks: 0, completedTasks: 0 };
    const taskCompletionRate = taskStats.totalTasks
      ? (taskStats.completedTasks / taskStats.totalTasks) * 100
      : 0;

    const daysSinceJoin = Math.max(
      Math.floor(
        (Date.now() - new Date(profile.createdAt).getTime()) /
          (1000 * 60 * 60 * 24)
      ),
      1
    );
    const averageDailyCoins = coinStats.allTimeCoins
      ? coinStats.allTimeCoins / daysSinceJoin
      : 0;

    // Wallet coins
    const profileBalance = await srkTaskUserBalanceModel
      .findOne({ taskUserId })
      .lean();

    const getPercentageChange = (current = 0, previous = 0) => {
      if (previous === 0) {
        return current > 0 ? 100 : 0;
      }
      return Number((((current - previous) / previous) * 100).toFixed(2));
    };

    const percentageChanges = {
      today: getPercentageChange(coinStats.today, coinStats.yesterday),
      last7Days: getPercentageChange(coinStats.last7Days, coinStats.prev7Days),
      last28Days: getPercentageChange(
        coinStats.last28Days,
        coinStats.prev28Days
      ),
    };

    return {
      status: 200,
      body: {
        coinsData: {
          walletCoins: profileBalance?.currentCoins ?? 0,
          today: coinStats.today ?? 0,
          todayChange: percentageChanges.today,
          last7Days: coinStats.last7Days ?? 0,
          last7DaysChange: percentageChanges.last7Days,
          last28Days: coinStats.last28Days ?? 0,
          last28DaysChange: percentageChanges.last28Days,
          allTimeCoins: coinStats.allTimeCoins ?? 0,
        },
        tasksData: {
          averageDailyCoins,
          peakDayCoins,
          taskCompletionRate,
        },
      },
    };
  } catch (error) {
    console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return {
        status: 500,
        body: {
          success: false,
          message: `Internal server error: ${errorMessage}`,
        },
      };
  }
};

const getStartDateFromTimeRange = (timeRange: 'weekly' | 'monthly' | 'all') => {
  switch (timeRange) {
    case 'weekly':
      return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    case 'monthly':
      return new Date(Date.now() - 28 * 24 * 60 * 60 * 1000);
    case 'all':
    default:
      return null;
  }
};

const getAllSrkTaskUserEarningsLeaderboard: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getAllSrkTaskUserEarningsLeaderboard
> = async ({ query }) => {
  try {
    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 10);
    const skip = (page - 1) * limit;
    const search = query?.search?.trim();

    const currentUserId = query?.currentUserId;

    const timeRange = query?.timeRange ?? 'all';

    // Time range filter
    const startDate = getStartDateFromTimeRange(timeRange);
    const dateFilter = startDate
      ? {
          createdAt: {
            $gte: startDate,
          },
        }
      : {};

    // Aggregate leaderboard
    const earningsLeaderboardAgg = await srkTaskEarningStatementModel.aggregate(
      [
        { $match: { type: 'credit', ...dateFilter } },
        {
          $group: {
            _id: '$taskUserId',
            coins: { $sum: '$coin' },
            firstActivity: { $min: '$createdAt' },
          },
        },
        {
          $lookup: {
            from: 'srktaskusers',
            localField: '_id',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        {
          $lookup: {
            from: 'users',
            localField: 'user.srkUniversityUserId',
            foreignField: '_id',
            as: 'universityUser',
          },
        },
        {
          $unwind: {
            path: '$universityUser',
            preserveNullAndEmptyArrays: true,
          },
        },

        // Add search filter if search query exists
        ...(search
          ? [
              {
                $match: {
                  'user.fullName': { $regex: search, $options: 'i' }, // case-insensitive
                },
              },
            ]
          : []),

        {
          $addFields: {
            userId: { $toString: '$_id' },
            fullName: '$user.fullName',
            email: '$universityUser.email',
            phone: '$universityUser.phoneNumber',
            isActivated: '$user.isActivated',
            consistencyDays: {
              $floor: {
                $divide: [
                  { $subtract: [new Date(), '$firstActivity'] },
                  1000 * 60 * 60 * 24,
                ],
              },
            },
          },
        },
        { $sort: { coins: -1 } },
        {
          $setWindowFields: {
            sortBy: { coins: -1 },
            output: { rank: { $rank: {} } },
          },
        },
        { $skip: skip },
        { $limit: limit },
        {
          $project: {
            _id: 0,
            rank: 1,
            userId: 1,
            fullName: 1,
            email: 1,
            phone: 1,
            isActivated: 1,
            coins: 1,
            consistencyDays: 1,
            change: { $literal: 0 },
          },
        },
      ]
    );

    // Total users for pagination
    const totalRecordsAgg = await srkTaskEarningStatementModel.aggregate([
      { $match: { type: 'credit', ...dateFilter } },
      { $group: { _id: '$taskUserId' } },
      { $count: 'totalUsers' },
    ]);

    const totalRecords = totalRecordsAgg[0]?.totalUsers ?? 0;
    const totalPages = Math.ceil(totalRecords / limit);

    // Current user stats
    let currentUser = null;
    if (currentUserId) {
      const userAgg = await srkTaskEarningStatementModel.aggregate([
        {
          $match: {
            taskUserId: new mongoose.Types.ObjectId(currentUserId),
            type: 'credit',
            ...dateFilter,
          },
        },
        {
          $group: {
            _id: '$taskUserId',
            coins: { $sum: '$coin' },
            firstActivity: { $min: '$createdAt' },
          },
        },
        {
          $lookup: {
            from: 'srktaskusers',
            localField: '_id',
            foreignField: '_id',
            as: 'user',
          },
        },
        { $unwind: '$user' },
        {
          $addFields: {
            fullName: '$user.fullName',
            consistencyDays: {
              $floor: {
                $divide: [
                  { $subtract: [new Date(), '$firstActivity'] },
                  1000 * 60 * 60 * 24,
                ],
              },
            },
            change: 0,
          },
        },
        {
          $project: {
            _id: 0,
            fullName: 1,
            coins: 1,
            consistencyDays: 1,
            change: 1,
          },
        },
      ]);
      currentUser = userAgg[0] || null;
    }

    return {
      status: 200,
      body: {
        page,
        limit,
        totalRecords: totalRecords,
        totalPages,
        data: {
          leaderboard: earningsLeaderboardAgg,
          currentUser,
          timeRange,
        },
      },
    };
  } catch (error) {
    console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return {
        status: 500,
        body: {
          success: false,
          message: `Internal server error: ${errorMessage}`,
        },
      };
  }
};

const getAllSrkTaskEarningPayoutsByAdmin: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getAllSrkTaskEarningPayoutsByAdmin
> = async ({ query }) => {
  try {
    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 10);
    const skip = (page - 1) * limit;
    const status = query?.status;

    // Find payout requests with optional status filter
    const filter = status ? { status } : {};
    const [totalRecords, payouts] = await Promise.all([
      srkTasksEarningsPayoutModel.countDocuments(filter),
      srkTasksEarningsPayoutModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'taskUserId',
          select: 'fullName srkUniversityUserId',
          populate: {
            path: 'srkUniversityUserId',
            select: 'email',
          },
        }),
    ]);

    // Get payment details for each user
    const userIds = payouts.map((p) => (p.taskUserId as any)?._id).filter(Boolean);
    const paymentDetailsMap = new Map();

    if (userIds.length > 0) {
      const paymentDetails = await srkTaskUserPaymentDetailsRequestModel.find({
        srkTaskUserId: { $in: userIds },
        status: 'approved',
        isActive: true,
      }).lean();

      paymentDetails.forEach((pd) => {
        paymentDetailsMap.set(pd.srkTaskUserId.toString(), pd);
      });
    }

    return {
      status: 200,
      body: {
        page,
        limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        data: payouts.map((payout) => {
          const taskUser = payout.taskUserId as any;
          const userId = taskUser?._id?.toString() || '';
          const paymentDetails = paymentDetailsMap.get(userId);

          return {
            _id: payout._id.toString(),
            taskUserId: {
              _id: userId,
              fullName: taskUser?.fullName || 'Unknown User',
              email: taskUser?.srkUniversityUserId?.email || 'Unknown Email',
            },
            paymentDetails: paymentDetails
              ? {
                  accountHolderName: paymentDetails.accountHolderName,
                  bankName: paymentDetails.bankName,
                  accountNumber: paymentDetails.accountNumber,
                  branchName: paymentDetails.branchName,
                  qrCodeUrl: paymentDetails.qrCodeUrl,
                }
              : null,
            transactionId: payout.transactionId || null,
            coinsUsed: payout.coinsUsed,
            tds: payout.tds,
            amount: payout.amount,
            status: payout.status,
            paymentScreenshotUrl: payout.paymentScreenshotUrl || null,
            rejectionReason: payout.rejectionReason || null,
            createdAt: payout.createdAt.toISOString(),
            updatedAt: payout.updatedAt.toISOString(),
          };
        }),
      },
    };
  } catch (error) {
    console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return {
        status: 500,
        body: {
          success: false,
          message: errorMessage,
        },
      };
  }
};

const getSrkTaskOnboardingVerificationRequestForAdmin: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getSrkTaskOnboardingVerificationRequestForAdmin
> = async ({ query }) => {
  try {
    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 10);
    const skip = (page - 1) * limit;
    const status = query?.status;

    const filter = status ? { status } : {};

    const [totalRecords, verificationRequests] = await Promise.all([
      srkTaskOnboardingVerificationRequestModel.countDocuments(filter),
      srkTaskOnboardingVerificationRequestModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'taskUserId',
          select: 'fullName dob isActivated srkUniversityUserId',
          populate: {
            path: 'srkUniversityUserId',
            select: 'email phoneNumber',
          },
        })
        .lean(),
    ]);

    return {
      status: 200,
      body: {
        page,
        limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        data: verificationRequests
          .filter((request) => request.taskUserId !== null) // Filter out orphaned requests
          .map((request) => {
            const taskUser = request.taskUserId as any;
            return {
              _id: request._id.toString(),
              taskUserId: {
                _id: taskUser._id.toString(),
                fullName: taskUser.fullName,
                dob: taskUser.dob,
                isActivated: taskUser.isActivated,
                srkUniversityUserId: {
                  _id: taskUser.srkUniversityUserId._id.toString(),
                  email: taskUser.srkUniversityUserId.email,
                  phoneNumber: taskUser.srkUniversityUserId.phoneNumber,
                },
              },
              kycDocumentUrl: request.kycDocumentUrl,
              imageUrl: request.imageUrl,
              signatureUrl: request.signatureUrl,
              status: request.status,
              rejectionReason: request.rejectionReason || null,
              createdAt: request.createdAt.toISOString(),
              updatedAt: request.updatedAt.toISOString(),
            };
          }),
      },
    };
  } catch (error) {
    console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return {
        status: 500,
        body: {
          success: false,
          message: errorMessage,
        },
      };
  }
};

// Implementation for getAllSrkTaskEarningPayoutsByUser
const getSrkTaskUserEarningsPayoutsByUser: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getSrkTaskUserEarningsPayoutsByUser
> = async ({ params, query }) => {
  try {
    const userId = params?.userId;
    if (!userId) {
      return {
        status: 400,
        body: { success: false, message: 'Missing userId' },
      };
    }
    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 10);
    const skip = (page - 1) * limit;
    const status = query?.status;
    const approvedPaymentDetails =
      await srkTaskUserPaymentDetailsRequestModel.findOne({
        srkTaskUserId: userId,
        status: 'approved',
        isActive: true,
      });

    const filter: {
      taskUserId: string;
      status?: 'pending' | 'approved' | 'rejected' | 'claimed';
    } = {
      taskUserId: userId,
    };
    if (status) filter.status = status;

    const [totalRecords, payouts] = await Promise.all([
      srkTasksEarningsPayoutModel.countDocuments(filter),
      srkTasksEarningsPayoutModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'taskUserId',
          select: 'fullName srkUniversityUserId',
          populate: {
            path: 'srkUniversityUserId',
            select: 'email',
          },
        }),
    ]);

    return {
      status: 200,
      body: {
        page,
        limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        data: payouts.map((payout) => {
          const taskUser = payout.taskUserId as any;
          return {
            _id: payout._id.toString(),
            taskUserId: {
              _id: taskUser?._id?.toString() || '',
              fullName: taskUser?.fullName || 'Unknown User',
              email: taskUser?.srkUniversityUserId?.email || 'Unknown Email',
            },
            amount: payout.amount,
            coinsUsed: payout.coinsUsed,
            tds: payout.tds,
            transactionId: payout.transactionId || null,
            status: payout.status,
            paymentDetails: approvedPaymentDetails
              ? {
                  accountHolderName:
                    approvedPaymentDetails.accountHolderName || '',
                  bankName: approvedPaymentDetails.bankName || '',
                  accountNumber: approvedPaymentDetails.accountNumber || '',
                  branchName: approvedPaymentDetails.branchName || '',
                  qrCodeUrl: approvedPaymentDetails.qrCodeUrl || '',
                }
              : null,
            paymentScreenshotUrl: payout.paymentScreenshotUrl || null,
            rejectionReason: payout.rejectionReason || null,
            createdAt: payout.createdAt.toISOString(),
            updatedAt: payout.updatedAt.toISOString(),
          };
        }),
      },
    };
  } catch (error) {
    console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return {
        status: 500,
        body: {
          success: false,
          message: errorMessage,
        },
      };
  }
};

const getAllSrkTaskUserFinanceStatement: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getAllSrkTaskUserFinanceStatement
> = async ({ params, query }) => {
  try {
    const { userId } = params;
    const taskUserId = new mongoose.Types.ObjectId(userId);

    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 10);
    const skip = (page - 1) * limit;
    const type = query?.type;

    const filter: any = { taskUserId };
    if (type) {
      filter.type = type;
    }

    const [totalRecords, earnings] = await Promise.all([
      srkTaskEarningStatementModel.countDocuments(filter),
      srkTaskEarningStatementModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ]);

    return {
      status: 200,
      body: {
        page,
        limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        data: earnings.map((earning) => ({
          _id: earning._id?.toString() || '',
          taskUserId: earning.taskUserId?.toString() || '',
          growPackageTodoId: earning.growPackageTodoId?.toString() || '',
          description: earning.description,
          type: earning.type,
          coin: earning.coin ?? 0,
          coinAfterTransaction: earning.coinAfterTransaction ?? 0,
          createdAt: earning.createdAt
            ? new Date(earning.createdAt).toISOString()
            : '',
          updatedAt: earning.updatedAt
            ? new Date(earning.updatedAt).toISOString()
            : '',
        })),
      },
    };
  } catch (error) {
    console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return {
        status: 500,
        body: {
          success: false,
          message: errorMessage,
        },
      };
  }
};

const getAllSrkTasksActionSubmissionsByUser: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getAllSrkTasksActionSubmissionsByUser
> = async ({ params, query }) => {
  try {
    const { userId } = params;
    const taskUserId = new mongoose.Types.ObjectId(userId);

    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 10);
    const skip = (page - 1) * limit;
    const status = query?.status;

    const filter: {
      taskUserId: mongoose.Types.ObjectId;
      status?: 'pending' | 'approved' | 'rejected' | 'claimed';
    } = { taskUserId };
    if (status) {
      filter.status = status;
    }

    const [totalRecords, submissions] = await Promise.all([
      srkTaskActionSubmissionModel.countDocuments(filter),
      srkTaskActionSubmissionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'taskUserId',
          select: 'fullName email phoneNumber',
        })
        .populate({
          path: 'growPackageTodoId',
          populate: {
            path: 'growSocialMediaPackageEnrollmentId',
            populate: [
              { path: 'growSocialMediaPackageId' },
              { path: 'growSocialMediaPackageTypeId' },
              { path: 'growSocialMediaPackageSubTypeId' },
            ],
          },
        })
        .lean(),
    ]);

    const data = submissions.map((submission: any) => {
      const enrollment =
        submission.growPackageTodoId?.growSocialMediaPackageEnrollmentId;
      return {
        _id: submission._id.toString(),
        type: submission.type,
        description: submission.description,
        screenshotUrl: submission.screenshotUrl,
        status: submission.status,
        rejectionReason: submission.rejectionReason || null,
        createdAt: submission.createdAt?.toISOString?.() || '',
        updatedAt: submission.updatedAt?.toISOString?.() || '',
        hasClaimedEarning: submission.hasClaimedEarning ?? true,
        taskUserId: submission.taskUserId
          ? {
              _id: submission.taskUserId._id.toString(),
              fullName: submission.taskUserId.fullName || 'N/A',
              email: submission.taskUserId.email || 'N/A',
              phoneNumber: submission.taskUserId.phoneNumber || 'N/A',
            }
          : undefined,
        growPackageTodoId: submission.growPackageTodoId
          ? {
              _id: submission.growPackageTodoId._id.toString(),
              postUrl: submission.growPackageTodoId.postUrl || '',
              profileUrl: submission.growPackageTodoId.profileUrl || '',
              type: submission.growPackageTodoId.type,
              platform: submission.growPackageTodoId.platform || '',
              followCounts: submission.growPackageTodoId.followCounts || 0,
              likeCounts: submission.growPackageTodoId.likeCounts || 0,
              enrollment: enrollment
                ? {
                    _id: enrollment._id.toString(),
                    socialMediaPlatform: enrollment.socialMediaPlatform || '',
                    profileLinkURL: enrollment.profileLinkURL || [],
                    amount: enrollment.amount || 0,
                    isActive: enrollment.isActive || false,
                    growSocialMediaPackageId: enrollment.growSocialMediaPackageId
                      ? {
                          _id:
                            enrollment.growSocialMediaPackageId._id?.toString?.() ||
                            '',
                          name: enrollment.growSocialMediaPackageId.name || '',
                          description:
                            enrollment.growSocialMediaPackageId.description || '',
                          socialMediaPlatforms:
                            enrollment.growSocialMediaPackageId
                              .socialMediaPlatforms || [],
                          amount: enrollment.growSocialMediaPackageId.amount || 0,
                        }
                      : undefined,
                    growSocialMediaPackageTypeId:
                      enrollment.growSocialMediaPackageTypeId
                        ? {
                            _id:
                              enrollment.growSocialMediaPackageTypeId._id?.toString?.() ||
                              '',
                            name:
                              enrollment.growSocialMediaPackageTypeId.name || '',
                            description:
                              enrollment.growSocialMediaPackageTypeId
                                .description || '',
                            amount:
                              enrollment.growSocialMediaPackageTypeId.amount || 0,
                          }
                        : undefined,
                    growSocialMediaPackageSubTypeId:
                      enrollment.growSocialMediaPackageSubTypeId
                        ? {
                            _id:
                              enrollment.growSocialMediaPackageSubTypeId._id?.toString?.() ||
                              '',
                            name:
                              enrollment.growSocialMediaPackageSubTypeId.name ||
                              '',
                            description:
                              enrollment.growSocialMediaPackageSubTypeId
                                .description || '',
                            taskType:
                              enrollment.growSocialMediaPackageSubTypeId.taskType ||
                              '',
                            noOfLikes:
                              enrollment.growSocialMediaPackageSubTypeId.noOfLikes,
                            noOfVideos:
                              enrollment.growSocialMediaPackageSubTypeId.noOfVideos,
                            noOfFollowers:
                              enrollment.growSocialMediaPackageSubTypeId.noOfFollowers,
                          }
                        : undefined,
                  }
                : undefined,
            }
          : undefined,
      };
    });

    return {
      status: 200,
      body: {
        page,
        limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        data,
      },
    };
  } catch (error: unknown) {
    console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return {
        status: 500,
        body: {
          success: false,
          message: errorMessage,
        },
      };
  }
};

const getRejectedSrkTaskActionSubmissionsByUser: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getRejectedSrkTaskActionSubmissionsByUser
> = async ({ params, query }) => {
  try {
    const { userId } = params;
    const taskUserId = new mongoose.Types.ObjectId(userId);

    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 10);
    const skip = (page - 1) * limit;

    // Filter for rejected submissions only
    const filter: any = {
      taskUserId,
      status: 'rejected',
    };

    const [totalRecords, submissions] = await Promise.all([
      srkTaskActionSubmissionModel.countDocuments(filter),
      srkTaskActionSubmissionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'growPackageTodoId',
          populate: {
            path: 'growSocialMediaPackageEnrollmentId',
            populate: [
              { path: 'growSocialMediaPackageId' },
              { path: 'growSocialMediaPackageTypeId' },
              { path: 'growSocialMediaPackageSubTypeId' },
            ],
          },
        })
        .lean(),
    ]);

    const data = submissions.map((submission: any) => {
      const enrollment =
        submission.growPackageTodoId?.growSocialMediaPackageEnrollmentId;
      return {
        _id: submission._id.toString(),
        type: submission.type,
        description: submission.description,
        screenshotUrl: submission.screenshotUrl,
        status: submission.status,
        rejectionReason: submission.rejectionReason || null,
        createdAt: new Date(submission.createdAt).toISOString(),
        updatedAt: new Date(submission.updatedAt).toISOString(),
        hasClaimedEarning: submission.hasClaimedEarning ?? true,
        growPackageTodoId: submission.growPackageTodoId
          ? {
              _id: submission.growPackageTodoId._id.toString(),
              postUrl: submission.growPackageTodoId.postUrl || '',
              profileUrl: submission.growPackageTodoId.profileUrl || '',
              type: submission.growPackageTodoId.type,
              platform: submission.growPackageTodoId.platform || '',
              followCounts: submission.growPackageTodoId.followCounts || 0,
              likeCounts: submission.growPackageTodoId.likeCounts || 0,
              enrollment: enrollment
                ? {
                    _id: enrollment._id.toString(),
                    socialMediaPlatform: enrollment.socialMediaPlatform || '',
                    profileLinkURL: enrollment.profileLinkURL || [],
                    amount: enrollment.amount || 0,
                    isActive: enrollment.isActive || false,
                    growSocialMediaPackageId:
                      enrollment.growSocialMediaPackageId
                        ? {
                            _id: enrollment.growSocialMediaPackageId._id.toString(),
                            name:
                              enrollment.growSocialMediaPackageId.name || '',
                            description:
                              enrollment.growSocialMediaPackageId.description ||
                              '',
                            socialMediaPlatforms:
                              enrollment.growSocialMediaPackageId
                                .socialMediaPlatforms || [],
                            amount:
                              enrollment.growSocialMediaPackageId.amount || 0,
                          }
                        : undefined,
                    growSocialMediaPackageTypeId:
                      enrollment.growSocialMediaPackageTypeId
                        ? {
                            _id: enrollment.growSocialMediaPackageTypeId._id.toString(),
                            name:
                              enrollment.growSocialMediaPackageTypeId.name ||
                              '',
                            description:
                              enrollment.growSocialMediaPackageTypeId
                                .description || '',
                            amount:
                              enrollment.growSocialMediaPackageTypeId.amount ||
                              0,
                          }
                        : undefined,
                    growSocialMediaPackageSubTypeId:
                      enrollment.growSocialMediaPackageSubTypeId
                        ? {
                            _id: enrollment.growSocialMediaPackageSubTypeId._id.toString(),
                            name:
                              enrollment.growSocialMediaPackageSubTypeId.name ||
                              '',
                            description:
                              enrollment.growSocialMediaPackageSubTypeId
                                .description || '',
                            taskType:
                              enrollment.growSocialMediaPackageSubTypeId
                                .taskType || '',
                            noOfLikes:
                              enrollment.growSocialMediaPackageSubTypeId
                                .noOfLikes,
                            noOfVideos:
                              enrollment.growSocialMediaPackageSubTypeId
                                .noOfVideos,
                            noOfFollowers:
                              enrollment.growSocialMediaPackageSubTypeId
                                .noOfFollowers,
                          }
                        : undefined,
                  }
                : undefined,
            }
          : undefined,
      };
    });

    return {
      status: 200,
      body: {
        page,
        limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        data,
      },
    };
  } catch (error) {
    console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return {
        status: 500,
        body: {
          success: false,
          message: errorMessage,
        },
      };
  }
};

const getSrkTaskActionsByPlatforms: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getSrkTaskActionsByPlatforms
> = async ({ query }) => {
  try {
    const { platform, type, srkTaskUserId } = query;

    // add here paginations

    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 10);
    const skip = (page - 1) * limit;

    const queryFilter: any = {};
    if (platform) {
      queryFilter['platform'] = platform;
    }
    if (type) {
      queryFilter['type'] = type;
    }

    // Only the ids are needed, so skip full document hydration; the user's
    // submitted todos are independent of the enrollments, so fetch both at once.
    const [growPackageEnrollments, submittedTodoIds] = await Promise.all([
      growSocialMediaPackageEnrollmentModel
        .find({
          isActive: true,
          type,
          socialMediaPlatform: platform,
        })
        .select('_id')
        .lean(),
      srkTaskUserId
        ? srkTaskActionSubmissionModel
            .find({ taskUserId: new mongoose.Types.ObjectId(srkTaskUserId) })
            .select('growPackageTodoId')
            .lean()
            .then((submissions) => submissions.map((s) => s.growPackageTodoId))
        : Promise.resolve([] as any[]),
    ]);

    const enrollmentIds = growPackageEnrollments.map((e) => e._id);

    // Build filter to exclude already submitted todos
    const todoFilter: any = {
      growSocialMediaPackageEnrollmentId: { $in: enrollmentIds },
    };
    if (submittedTodoIds.length > 0) {
      todoFilter._id = { $nin: submittedTodoIds };
    }

    const [srkTaskTodos, totalSrkTodos] = await Promise.all([
      growPackageTodoModel
        .find(todoFilter)
        .populate<{
          growSocialMediaPackageEnrollmentId: {
            growSocialMediaPackageUserId: { fullName: string };
          };
        }>({
          path: 'growSocialMediaPackageEnrollmentId',
          populate: {
            path: 'growSocialMediaPackageUserId',
            select: 'fullName',
          },
        })
        .skip(skip)
        .limit(limit)
        .lean(),
      growPackageTodoModel.countDocuments(todoFilter),
    ]);

    return {
      status: 200,
      body: {
        data: srkTaskTodos.map((action) => ({
          actionId: action._id.toString(),
          socialMediaPlatform: action.platform,
          username:
            action.growSocialMediaPackageEnrollmentId
              .growSocialMediaPackageUserId.fullName,
          profileLinkURL: action.profileUrl || null,
          taskType: action.type,
          postUrl: action.postUrl || null,
        })),
        totalRecords: totalSrkTodos,
        limit,
        page,
        totalPages: Math.ceil(totalSrkTodos / limit),
      },
    };
  } catch (error) {
    console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return {
        status: 500,
        body: {
          success: false,
          message: errorMessage,
        },
      };
  }
};

const getAllSrkTaskUsersForAdmin: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getAllSrkTaskUsersForAdmin
> = async ({ query }) => {
  try {
    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 10);
    const skip = (page - 1) * limit;
    const search = query?.search?.trim();
    const isActivated = query?.isActivated;

    // Build filter
    const filter: any = {};
    if (search) {
      filter.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { 'srkUniversityUserId.email': { $regex: search, $options: 'i' } },
      ];
    }
    if (isActivated !== undefined) {
      filter.isActivated = isActivated === 'true';
    }

    const [totalRecords, users] = await Promise.all([
      srkTaskUserModel.countDocuments(filter),
      srkTaskUserModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'srkUniversityUserId',
          select: 'email phoneNumber packageId',
          populate: {
            path: 'packageId',
            select: 'title',
          },
        })
        .lean(),
    ]);

    // Get additional stats for each user
    const userIds = users.map((u) => u._id);

    // Get coins earned for each user
    const coinsAgg = await srkTaskEarningStatementModel.aggregate([
      {
        $match: {
          taskUserId: { $in: userIds },
          type: 'credit',
        },
      },
      {
        $group: {
          _id: '$taskUserId',
          totalCoins: { $sum: '$coin' },
        },
      },
    ]);

    // Get tasks completed for each user
    const tasksAgg = await srkTaskActionSubmissionModel.aggregate([
      {
        $match: {
          taskUserId: { $in: userIds },
        },
      },
      {
        $group: {
          _id: '$taskUserId',
          totalTasks: { $sum: 1 },
          completedTasks: {
            $sum: {
              $cond: [{ $eq: ['$status', 'approved'] }, 1, 0],
            },
          },
        },
      },
    ]);

    // Get KYC status for each user
    const kycAgg = await srkTaskOnboardingVerificationRequestModel.aggregate([
      {
        $match: {
          taskUserId: { $in: userIds },
        },
      },
      {
        $sort: { createdAt: -1 },
      },
      {
        $group: {
          _id: '$taskUserId',
          latestStatus: { $first: '$status' },
        },
      },
    ]);

    // Create lookup maps
    const coinsMap = new Map(
      coinsAgg.map((c) => [c._id.toString(), c.totalCoins])
    );
    const tasksMap = new Map(
      tasksAgg.map((t) => [
        t._id.toString(),
        { total: t.totalTasks, completed: t.completedTasks },
      ])
    );
    const kycMap = new Map(
      kycAgg.map((k) => [k._id.toString(), k.latestStatus])
    );

    const data = users.map((user) => {
      const userId = user._id.toString();
      const universityUser = user.srkUniversityUserId as any;
      const coins = coinsMap.get(userId) || 0;
      const tasks = tasksMap.get(userId) || { total: 0, completed: 0 };
      const kycStatus = kycMap.get(userId) || null;

      return {
        _id: userId,
        fullName: user.fullName,
        email: universityUser?.email || 'N/A',
        phone: universityUser?.phoneNumber || 'N/A',
        packageName: universityUser?.packageId?.title || 'No Package',
        dob: user.dob,
        isActivated: user.isActivated,
        kycStatus,
        totalCoins: coins,
        totalTasks: tasks.total,
        completedTasks: tasks.completed,
        successRate:
          tasks.total > 0 ? (tasks.completed / tasks.total) * 100 : 0,
        joinedAt: user.createdAt.toISOString(),
        updatedAt: user.updatedAt.toISOString(),
      };
    });

    return {
      status: 200,
      body: {
        page,
        limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        data,
      },
    };
  } catch (error) {
    console.error(error);
      const errorMessage = error instanceof Error ? error.message : 'Internal server error';
      return {
        status: 500,
        body: {
          success: false,
          message: errorMessage,
        },
      };
  }
};

const getAllPendingTaskSubmissionsByUserForAdmin: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getAllPendingTaskSubmissionsByUserForAdmin
> = async ({ query }) => {
  try {
    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 10);
    const skip = (page - 1) * limit;
    const taskUserId = query.taskUserId;

    const filter = {
      taskUserId,
      status: 'pending',
    };

    const [totalRecords, submissions] = await Promise.all([
      srkTaskActionSubmissionModel.countDocuments(filter),
      srkTaskActionSubmissionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate<{
          taskUserId: any;
        }>({
          path: 'taskUserId',
          populate: {
            path: 'srkUniversityUserId',
            select: 'fullName email phoneNumber packageId',
            populate: {
              path: 'packageId',
              select: 'title',
            },
          },
        })
        .populate<{
          growPackageTodoId: any;
        }>({
          path: 'growPackageTodoId',
          populate: {
            path: 'growSocialMediaPackageEnrollmentId',
            populate: [
              { path: 'growSocialMediaPackageId' },
              { path: 'growSocialMediaPackageTypeId' },
              { path: 'growSocialMediaPackageSubTypeId' },
            ],
          },
        }),
    ]);

    const data = await Promise.all(
      submissions.map(async (submission: any) => {
        const taskUser = submission.taskUserId;
        const todo = submission.growPackageTodoId;
        const enrollment = todo?.growSocialMediaPackageEnrollmentId;

        // Get approved count for today and balance for this user
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const [approvedCount, balance] = await Promise.all([
          taskUser
            ? srkTaskActionSubmissionModel.countDocuments({
                taskUserId: taskUserId,
                status: 'approved',
                createdAt: { $gte: today },
              })
            : Promise.resolve(0),
          taskUser
            ? srkTaskUserBalanceModel
                .findOne({
                  $or: [{ taskUserId: taskUserId }, { taskUserId: taskUserId.toString() }],
                })
                .lean()
            : Promise.resolve(null),
        ]);

        return {
          _id: submission._id.toString(),
          type: submission.type,
          description: submission.description,
          hasClaimedEarning: submission.hasClaimedEarning ?? true,
          taskUserId: taskUser
            ? {
                _id: taskUser._id.toString(),
                fullName:
                  taskUser.srkUniversityUserId?.fullName ||
                  taskUser.fullName ||
                  'N/A',
                email: taskUser.srkUniversityUserId?.email || 'N/A',
                phoneNumber: taskUser.srkUniversityUserId?.phoneNumber || 'N/A',
                packageName:
                  taskUser.srkUniversityUserId?.packageId?.title ||
                  'SRK Basic',
                approvedCount,
                currentCoins: balance?.currentCoins || 0,
                totalCoinsEarned: balance?.totalCoinsEarned || 0,
              }
            : undefined,
          growPackageTodoId: todo
            ? {
              _id: todo._id.toString(),
              postUrl: todo.postUrl,
              profileUrl: todo.profileUrl,
              type: todo.type,
              platform: todo.platform,
              followCounts: todo.followCounts || 0,
              likeCounts: todo.likeCounts || 0,
              enrollment: enrollment
                ? {
                    _id: enrollment._id.toString(),
                    socialMediaPlatform: enrollment.socialMediaPlatform,
                    profileLinkURL: enrollment.profileLinkURL || [],
                    amount: enrollment.amount,
                    isActive: enrollment.isActive,
                    growSocialMediaPackageId:
                      enrollment.growSocialMediaPackageId
                        ? {
                            _id:
                              enrollment.growSocialMediaPackageId._id?.toString?.() ||
                              '',
                            name: enrollment.growSocialMediaPackageId.name,
                            description:
                              enrollment.growSocialMediaPackageId.description,
                            socialMediaPlatforms:
                              enrollment.growSocialMediaPackageId
                                .socialMediaPlatforms || [],
                            amount: enrollment.growSocialMediaPackageId.amount,
                          }
                        : undefined,
                    growSocialMediaPackageTypeId:
                      enrollment.growSocialMediaPackageTypeId
                        ? {
                            _id:
                              enrollment.growSocialMediaPackageTypeId._id?.toString?.() ||
                              '',
                            name: enrollment.growSocialMediaPackageTypeId.name,
                            description:
                              enrollment.growSocialMediaPackageTypeId
                                .description,
                            amount:
                              enrollment.growSocialMediaPackageTypeId.amount,
                          }
                        : undefined,
                    growSocialMediaPackageSubTypeId:
                      enrollment.growSocialMediaPackageSubTypeId
                        ? {
                            _id:
                              enrollment.growSocialMediaPackageSubTypeId._id?.toString?.() ||
                              '',
                            name: enrollment.growSocialMediaPackageSubTypeId
                              .name,
                            description:
                              enrollment.growSocialMediaPackageSubTypeId
                                .description,
                            taskType:
                              enrollment.growSocialMediaPackageSubTypeId
                                .taskType,
                            noOfLikes:
                              enrollment.growSocialMediaPackageSubTypeId
                                .noOfLikes,
                            noOfVideos:
                              enrollment.growSocialMediaPackageSubTypeId
                                .noOfVideos,
                            noOfFollowers:
                              enrollment.growSocialMediaPackageSubTypeId
                                .noOfFollowers,
                          }
                        : undefined,
                  }
                : undefined,
            }
          : undefined,
        screenshotUrl: submission.screenshotUrl,
        status: submission.status,
        rejectionReason: submission.rejectionReason || null,
        createdAt: submission.createdAt?.toISOString?.() || '',
        updatedAt: submission.updatedAt?.toISOString?.() || '',
      };
    })
    );

    return {
      status: 200,
      body: {
        page,
        limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        data,
      },
    };
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return {
      status: 500,
      body: {
        success: false,
        message: errorMessage,
      },
    };
  }
};

const getAllCompletedSrkTaskSubmissionsForAdmin: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getAllCompletedSrkTaskSubmissionsForAdmin
> = async ({ query }) => {
  try {
    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 20);
    const skip = (page - 1) * limit;
    const type = query?.type; // 'follow' or 'like'
    const platform = query?.platform; // 'Instagram', 'YouTube', etc.

    // Build filter - only approved submissions
    const filter: any = { status: 'approved' };
    if (type) {
      filter.type = type;
    }

    const [totalRecords, submissions] = await Promise.all([
      srkTaskActionSubmissionModel.countDocuments(filter),
      srkTaskActionSubmissionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'taskUserId',
          select: 'fullName srkUniversityUserId',
          populate: {
            path: 'srkUniversityUserId',
            select: 'email phoneNumber',
          },
        })
        .populate({
          path: 'growPackageTodoId',
          populate: {
            path: 'growSocialMediaPackageEnrollmentId',
            populate: {
              path: 'growSocialMediaPackageUserId',
              select: 'fullName email phoneNumber',
            },
          },
        })
        .lean(),
    ]);

    // Filter by platform if specified and map data
    const filteredData = submissions
      .filter((submission) => {
        const todo = submission.growPackageTodoId as any;
        if (!platform) return true;
        return todo?.platform === platform;
      })
      .map((submission) => {
        const taskUser = submission.taskUserId as any;
        const todo = submission.growPackageTodoId as any;
        const enrollment = todo?.growSocialMediaPackageEnrollmentId;
        const taskOwner = enrollment?.growSocialMediaPackageUserId;

        return {
          _id: submission._id.toString(),
          type: submission.type,
          platform: todo?.platform || 'Unknown',
          description: submission.description,
          screenshotUrl: submission.screenshotUrl,
          postUrl: todo?.postUrl || null,
          profileUrl: todo?.profileUrl || null,
          completedBy: {
            _id: taskUser?._id?.toString() || '',
            fullName: taskUser?.fullName || 'Unknown User',
            email: taskUser?.srkUniversityUserId?.email || 'N/A',
            phone: taskUser?.srkUniversityUserId?.phoneNumber || 'N/A',
          },
          taskOwner: taskOwner
            ? {
                fullName: taskOwner.fullName || 'Unknown Owner',
                email: taskOwner.email || 'N/A',
                phone: taskOwner.phoneNumber || 'N/A',
              }
            : null,
          coinEarned: todo?.type === 'follow' ? 10 : 5, // You can adjust this based on your business logic
          completedAt: submission.createdAt.toISOString(),
          updatedAt: submission.updatedAt.toISOString(),
        };
      });

    // Recalculate total after platform filtering
    const filteredTotal = filteredData.length;

    return {
      status: 200,
      body: {
        page,
        limit,
        totalRecords: platform ? filteredTotal : totalRecords,
        totalPages: Math.ceil(
          (platform ? filteredTotal : totalRecords) / limit
        ),
        data: filteredData,
      },
    };
  } catch (error: unknown) {
    console.error(error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return {
      status: 500,
      body: {
        success: false,
        message: errorMessage,
      },
    };
  }
};

const getApprovedSrkTaskAffiliateVerificationRequest: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getAllSrkTaskAffiliateVerificationRequest
> = async ({ query }) => {
  try {
    const srkUniversityUserId = query.srkUniversityUserId;
    if (!mongoose.isValidObjectId(srkUniversityUserId)) {
      return {
        status: 404,
        body: {
          success: false,
          message: 'Invalid University User ID',
        },
      };
    }
    console.log('srk university Id', srkUniversityUserId);
    // 1️⃣ Look for verification request
    const verificationRecord = await srkTaskUserModel
      .findOne({
        srkUniversityUserId,
      })
      .lean();

    // 2️⃣ Not found → pending
    if (!verificationRecord) {
      return {
        status: 404,
        body: {
          success: false,
          message: 'Not verified yet',
        },
      };
    }
    const srkTaskOnboardingVerificationRequestExists =
      await srkTaskOnboardingVerificationRequestModel.findOne({
        taskUserId: verificationRecord._id,
      });

    const affiliateData: {
      _id: string | mongoose.Types.ObjectId;
      srkUniversityUserId: string;
      fullName: string;
      dob: string;
      status: string;
      isActivated: boolean;
      createdAt: string;
      updatedAt: string;
    } = {
      _id: verificationRecord._id.toString(),
      srkUniversityUserId: verificationRecord.srkUniversityUserId.toString(),
      fullName: verificationRecord.fullName,
      dob: verificationRecord.dob,
      isActivated: verificationRecord.isActivated,
      status: srkTaskOnboardingVerificationRequestExists?.status || 'pending',
      createdAt: verificationRecord.createdAt.toISOString(),
      updatedAt: verificationRecord.updatedAt.toISOString(),
    };

    return {
      status: 200,
      body: {
        success: true,
        message: 'Affiliate request found',
        data: affiliateData,
      },
    };
  } catch (error: unknown) {
    console.log(error);
    const errorMessage = error instanceof Error ? error.message : 'Internal server error';
    return {
      status: 500,
      body: {
        success: false,
        message: errorMessage,
      },
    };
  }
};


// ============================================
// Payment Details Query Handlers
// ============================================

const getUserPaymentDetails: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getUserPaymentDetails
> = async ({ params }) => {
  try {
    const { userId } = params;

    // Get approved payment details (active approved request)
    const approvedDetails = await srkTaskUserPaymentDetailsRequestModel.findOne({
      srkTaskUserId: userId,
      status: 'approved',
      isActive: true,
    });

    // Get pending request if any
    const pendingRequest =
      await srkTaskUserPaymentDetailsRequestModel.findOne({
        srkTaskUserId: userId,
        status: 'pending',
      });

    // Get latest rejected request if any
    const rejectedRequest =
      await srkTaskUserPaymentDetailsRequestModel.findOne({
        srkTaskUserId: userId,
        status: 'rejected',
      }).sort({ createdAt: -1 });

    const formatPaymentDetails = (details: any) => details ? {
      _id: details._id.toString(),
      srkTaskUserId: details.srkTaskUserId.toString(),
      accountHolderName: details.accountHolderName,
      bankName: details.bankName,
      accountNumber: details.accountNumber,
      branchName: details.branchName,
      qrCodeUrl: details.qrCodeUrl,
      status: details.status,
      rejectionReason: details.rejectionReason,
      reviewedBy: details.reviewedBy?.toString(),
      reviewedAt: details.reviewedAt?.toISOString(),
      isActive: details.isActive,
      createdAt: details.createdAt.toISOString(),
      updatedAt: details.updatedAt.toISOString(),
    } : null;

    return {
      status: 200,
      body: {
        success: true,
        approvedDetails: formatPaymentDetails(approvedDetails),
        pendingRequest: formatPaymentDetails(pendingRequest),
        rejectedRequest: formatPaymentDetails(rejectedRequest),
      },
    };
  } catch (error: unknown) {
    console.error('Error fetching user payment details:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch payment details';
    return {
      status: 500,
      body: {
        success: false,
        message: errorMessage,
      },
    };
  }
};

const getAllPaymentDetailsRequestsForAdmin: AppRouteImplementationOrOptions<
  typeof srkTaskContract.getAllPaymentDetailsRequestsForAdmin
> = async ({ query }) => {
  try {
    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 10);
    const skip = (page - 1) * limit;
    const status = query?.status;

    const filter = status ? { status } : {};

    const [totalRecords, requests] = await Promise.all([
      srkTaskUserPaymentDetailsRequestModel.countDocuments(filter),
      srkTaskUserPaymentDetailsRequestModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate({
          path: 'srkTaskUserId',
          populate: {
            path: 'srkUniversityUserId',
            select: 'fullName email phoneNumber',
          },
        })
        .lean(),
    ]);

    const data = requests.map((request: any) => ({
      _id: request._id.toString(),
      srkTaskUserId: request.srkTaskUserId?.srkUniversityUserId
        ? {
            _id: request.srkTaskUserId._id.toString(),
            fullName:
              request.srkTaskUserId.srkUniversityUserId.fullName || '',
            email: request.srkTaskUserId.srkUniversityUserId.email || '',
            phoneNumber:
              request.srkTaskUserId.srkUniversityUserId.phoneNumber || '',
          }
        : request.srkTaskUserId._id.toString(),
      accountHolderName: request.accountHolderName,
      bankName: request.bankName,
      accountNumber: request.accountNumber,
      branchName: request.branchName,
      qrCodeUrl: request.qrCodeUrl,
      status: request.status,
      rejectionReason: request.rejectionReason,
      reviewedBy: request.reviewedBy?.toString(),
      reviewedAt: request.reviewedAt?.toISOString(),
      isActive: request.isActive,
      createdAt: request.createdAt.toISOString(),
      updatedAt: request.updatedAt.toISOString(),
    }));

    return {
      status: 200,
      body: {
        page,
        limit,
        totalRecords,
        totalPages: Math.ceil(totalRecords / limit),
        data,
      },
    };
  } catch (error: unknown) {
    console.error('Error fetching payment details requests:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch payment details requests';
    return {
      status: 500,
      body: {
        success: false,
        message: errorMessage,
      },
    };
  }
};

export const srkTaskQueryHandler = {
  getSrkTaskActionsByPlatforms,
  getSrkTaskUserProfile,
  getSrkTaskUserAnalytics,
  getAllSrkTaskUserEarningsLeaderboard,
  getAllSrkTaskEarningPayoutsByAdmin,
  getSrkTaskOnboardingVerificationRequestForAdmin,
  getSrkTaskUserEarningsPayoutsByUser,
  getAllSrkTasksActionSubmissionByStatusForAdmin,
  getAllSrkTasksActionSubmissionsByUser,
  getRejectedSrkTaskActionSubmissionsByUser,
  getAllSrkTaskUserFinanceStatement,
  getApprovedSrkTaskAffiliateVerificationRequest,
  getAllSrkTaskUsersForAdmin,
  getAllPendingTaskSubmissionsByUserForAdmin,
  getAllCompletedSrkTaskSubmissionsForAdmin,
  getUserPaymentDetails,
  getAllPaymentDetailsRequestsForAdmin,
};
