import { AppRouteImplementationOrOptions } from '@ts-rest/express/src/lib/types';
import { courseContract } from '@srk/shared/contracts';
import { CourseModel } from '../../model/courseModel';
import { CourseVideoModel, ICourseVideo } from '../../model/courseVideo';
import { deleteFileFromR2, extractR2Key } from '../../services/r2Service';

// Deletes every R2 object tied to a course video (main file, original
// pre-compression source, all quality renditions, thumbnail). Failures are
// logged but never thrown - an orphaned R2 object is preferable to blocking
// the DB delete the user actually asked for.
async function deleteCourseVideoR2Files(video: ICourseVideo): Promise<void> {
  const keys = [
    video.videoUrl,
    video.originalVideoUrl,
    video.thumbnailUrl,
    ...(video.videoRenditions?.map((r) => r.url) ?? []),
  ].filter((value): value is string => !!value);

  await Promise.all(
    keys.map(async (value) => {
      try {
        await deleteFileFromR2(extractR2Key(value));
      } catch (error) {
        console.error(`Failed to delete R2 object for course video ${video._id}:`, error);
      }
    })
  );
}

const createCourse: AppRouteImplementationOrOptions<
  typeof courseContract.createCourse
> = async ({ req, body }) => {
  await CourseModel.create({
    package: body.package,
    description: body.description,
    image: body.image,
    title: body.title,
  });

  return {
    status: 201,
    body: {
      success: true,
      message: 'Course created successfully',
    },
  };
};

const createVideoInCourse: AppRouteImplementationOrOptions<
  typeof courseContract.createVideoInCourse
> = async ({ req, body, params }) => {
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

  if (!body.name || !body.videoUrl || !body.duration || !params.courseId) {
    return {
      status: 400,
      body: {
        success: false,
        message: 'Please provide all the required fields',
      },
    };
  }

  await CourseVideoModel.create({
    name: body.name,
    courseId: params.courseId,
    videoUrl: body.videoUrl,
    duration: body.duration,
  });

  return {
    status: 201,
    body: {
      success: true,
      message: 'Video added to course successfully',
    },
  };
};

const updateCourse: AppRouteImplementationOrOptions<
  typeof courseContract.updateCourse
> = async ({ params, body }) => {
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

  await CourseModel.findByIdAndUpdate(params.id, body);

  return {
    status: 200,
    body: {
      success: true,
      message: 'Course updated successfully',
    },
  };
};

const deleteCourse: AppRouteImplementationOrOptions<
  typeof courseContract.deleteCourse
> = async ({ params }) => {
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

  const courseVideos = await CourseVideoModel.find({ courseId: params.id });
  await Promise.all(courseVideos.map((video) => deleteCourseVideoR2Files(video)));

  await CourseModel.findByIdAndDelete(params.id);
  await CourseVideoModel.deleteMany({ courseId: params.id });

  return {
    status: 200,
    body: {
      success: true,
      message: 'Course deleted successfully',
    },
  };
};

const updateVideoInCourse: AppRouteImplementationOrOptions<
  typeof courseContract.updateVideoInCourse
> = async ({ params, body }) => {
  const videoExist = await CourseVideoModel.findById(params.videoId);

  if (!videoExist) {
    return {
      status: 404,
      body: {
        success: false,
        message: 'Video not found',
      },
    };
  }

  await CourseVideoModel.findByIdAndUpdate(params.videoId, {
    name: body.name,
  });

  return {
    status: 200,
    body: {
      success: true,
      message: 'Video updated successfully',
    },
  };
};

const deleteVideoInCourse: AppRouteImplementationOrOptions<
  typeof courseContract.deleteVideoInCourse
> = async ({ params }) => {
  const videoExist = await CourseVideoModel.findById(params.videoId);

  if (!videoExist) {
    return {
      status: 404,
      body: {
        success: false,
        message: 'Video not found',
      },
    };
  }

  await deleteCourseVideoR2Files(videoExist);
  await CourseVideoModel.findByIdAndDelete(params.videoId);

  return {
    status: 200,
    body: {
      success: true,
      message: 'Video deleted successfully',
    },
  };
};

export const courseMutationHandler = {
  createCourse,
  updateCourse,
  deleteCourse,
  createVideoInCourse,
  updateVideoInCourse,
  deleteVideoInCourse,
};
