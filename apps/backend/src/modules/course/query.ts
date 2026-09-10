import { AppRouteImplementationOrOptions } from '@ts-rest/express/src/lib/types';
import { courseContract } from '@srk/shared/contracts';
import { CourseModel } from '../../model/courseModel';
import { CourseVideoModel } from '../../model/courseVideo';

const getAllCourses: AppRouteImplementationOrOptions<
  typeof courseContract.getAllCourses
> = async ({ req, res }) => {
  try {
    const { packageId } = req.query;
    const courses = await CourseModel.find({
      ...(packageId ? { package: packageId } : {}),
    });

    return {
      status: 200,
      body: courses.map((course) => ({
        _id: course._id.toString(),
        description: course.description,
        createdAt: course.createdAt,
        image: course.image,
        title: course.title,
        updatedAt: course.updatedAt,
      })),
    };
  } catch (error) {
    console.error(error);
    return {
      status: 500,
      body: {
        success: false,
        message: 'Internal server error',
      },
    };
  }
};

const getVideosOfCourse: AppRouteImplementationOrOptions<
  typeof courseContract.getVideosOfCourse
> = async ({ req, res, params }) => {
  try {
    const courseExist = await CourseModel.findById(params.courseId);

    if (!courseExist) {
      return {
        status: 404,
        body: {
          success: false,
          message: 'Course not found',
        },
      };
    }
    const courseVideos = await CourseVideoModel.find({
      courseId: params.courseId,
    });

    return {
      status: 200,
      body: courseVideos.map((video) => ({
        _id: video._id.toString(),
        videoUrl: video.videoUrl,
        thumbnailUrl: video.thumbnailUrl || '',
        created_at: video.createdAt,
        updatedAt: video.updatedAt,
        name: video.name,
        videoRenditions: video.videoRenditions || [],
      })),
    };
  } catch (error) {
    console.error(error);
    return {
      status: 500,
      body: {
        success: false,
        message: 'Internal server error',
      },
    };
  }
};

export const getCourseById: AppRouteImplementationOrOptions<
  typeof courseContract.getCourseById
> = async ({ req, params }) => {
  try {
    const courseExist = await CourseModel.findById(params.id);

    if (!courseExist) {
      return {
        status: 404,
        body: {
          success: false,
          message: 'Course not found',
        },
      };
    }

    return {
      status: 200,
      body: {
        _id: courseExist._id.toString(),
        description: courseExist.description,
        createdAt: courseExist.createdAt,
        title: courseExist.title,
        updatedAt: courseExist.updatedAt,
        image: courseExist.image,
      },
    };
  } catch (error) {
    console.error(error);
    return {
      status: 500,
      body: {
        success: false,
        message: 'Internal server error',
      },
    };
  }
};

export const courseQueryHandler = {
  getCourseById,
  getAllCourses,
  getVideosOfCourse,
};
