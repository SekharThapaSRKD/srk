"use client";

import { Button } from "@nextui-org/button";
import { Chip } from "@nextui-org/chip";
import { Card, CardHeader, CardBody } from "@nextui-org/card";
import { Select, SelectItem } from "@nextui-org/select";
import { PlayCircle, RotateCw, Wifi, WifiOff } from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { BreadcrumbItem, Breadcrumbs, Spinner } from "@nextui-org/react";
import clsx from "clsx";
import { useQuery } from "@tanstack/react-query";
import {
  getCourseDetailsByIdApi,
  getCourseVideoByCourseId,
} from "../../../lib/apiClient";
import { TCourse, TCourseVideo } from "../../../lib/types/entities";
import { useEffect, useMemo, useRef, useState } from "react";
import { getUniversityAssetUrl } from "../../../lib/cdn";
import { useNetworkStatus } from "../../../hooks/useNetworkStatus";

// Best -> worst. "original" is always the video's own videoUrl (native
// resolution); everything else comes from that video's videoRenditions,
// so only options that actually exist for a given video are ever shown.
const QUALITY_ORDER = ["original", "1080p", "720p", "480p", "360p"];
const QUALITY_LABELS: Record<string, string> = {
  original: "Original (best quality)",
  "1080p": "1080p",
  "720p": "720p (lower data use)",
  "480p": "480p (lower data use)",
  "360p": "360p (lowest data use)",
};

export default function CoursePlayer() {
  const { courseId } = useParams();
  const location = useLocation();
  const [currentVideo, setCurrentVideo] = useState<TCourseVideo | null>(null);
  const [isVideoLoading, setIsVideoLoading] = useState(true);
  const [hasVideoError, setHasVideoError] = useState(false);
  const [videoRetryKey, setVideoRetryKey] = useState(0);
  const [selectedQuality, setSelectedQuality] = useState("original");
  const videoRef = useRef<HTMLVideoElement>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const wasPlayingRef = useRef(false);
  const networkStatus = useNetworkStatus();
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [hasWatched] = useState(false);
  const { data: courseDetails, isLoading: isCourseLoading } = useQuery<
    TCourse | null
  >({
    queryKey: ["courseDetails", courseId],
    queryFn: async () => {
      if (!courseId) return;
      const data = await getCourseDetailsByIdApi(courseId);
      return data;
    },
  });

  const { data: chaptersData, isLoading: isChaptersLoading } = useQuery<
    TCourseVideo[]
  >({
    queryKey: ["chapters", courseId],
    queryFn: async () => {
      if (!courseId) return;
      const data = await getCourseVideoByCourseId(courseId);
      return data;
    },
  });

  const Breadcrumb = [
    {
      label: "Home",
      href: "/",
    },
    {
      label: "course-select",
      href: "/study/courses",
    },
    {
      label: `${courseDetails?.title}`,
      href: `/study/courses/${courseId}`,
    },
  ];

  useEffect(() => {
    if (chaptersData && chaptersData.length > 0) {
      setCurrentVideo(chaptersData[0]);
    }
  }, [chaptersData]);

  const availableQualities = useMemo(() => {
    const present = new Set([
      "original",
      ...((currentVideo?.videoRenditions || []).map((r) => r.quality)),
    ]);
    return QUALITY_ORDER.filter((q) => present.has(q));
  }, [currentVideo]);

  // Falls back to "original" if the previously-selected quality doesn't
  // exist for this particular video (e.g. renditions still being generated
  // for some courses) - derived at render time rather than synced via a
  // separate effect, so there's nothing to get out of sync.
  const effectiveQuality = availableQualities.includes(selectedQuality)
    ? selectedQuality
    : "original";

  const activeVideoUrl =
    effectiveQuality === "original"
      ? currentVideo?.videoUrl
      : currentVideo?.videoRenditions?.find(
          (r) => r.quality === effectiveQuality
        )?.url;

  useEffect(() => {
    setIsVideoLoading(true);
    setHasVideoError(false);
  }, [currentVideo?._id, videoRetryKey, effectiveQuality]);

  const recommendedQuality = useMemo(() => {
    const lowerTiers = availableQualities.filter((q) => q !== "original");
    if (networkStatus.quality === "poor") {
      return lowerTiers[lowerTiers.length - 1] || "original";
    }
    if (networkStatus.quality === "moderate") {
      return lowerTiers.includes("720p")
        ? "720p"
        : lowerTiers[lowerTiers.length - 1] || "original";
    }
    return "original";
  }, [networkStatus.quality, availableQualities]);

  const handleQualityChange = (quality: string) => {
    if (videoRef.current) {
      pendingSeekRef.current = videoRef.current.currentTime;
      wasPlayingRef.current = !videoRef.current.paused;
    }
    setSelectedQuality(quality);
  };

  const handleLoadedMetadata = () => {
    if (pendingSeekRef.current !== null && videoRef.current) {
      videoRef.current.currentTime = pendingSeekRef.current;
      pendingSeekRef.current = null;
      if (wasPlayingRef.current) {
        videoRef.current.play().catch(() => undefined);
      }
    }
  };

  if (isCourseLoading || isChaptersLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Spinner size="lg" color="primary" />
      </div>
    );
  }

  if (!courseDetails) return null;

  return (
    <div className="container mx-auto p-4 space-y-8">
      <Breadcrumbs>
        {Breadcrumb.map((breadcrumb) => (
          <BreadcrumbItem
            key={breadcrumb.href}
            classNames={{
              item: clsx(
                breadcrumb.href === location.pathname
                  ? "text-white"
                  : "text-primary font-semibold"
              ),
              separator: "text-white",
            }}
          >
            {" "}
            <Link to={breadcrumb.href}>
              <span>{breadcrumb.label}</span>
            </Link>
          </BreadcrumbItem>
        ))}
      </Breadcrumbs>

      {/* <Progress
        value={progress}
        className="max-w-md float-end"
        color="primary"
      /> */}
      <div className="flex flex-wrap gap-2 justify-end items-center text-textPrimary mb-2">
        {networkStatus.supported && (
          <div className="flex items-center gap-1 text-xs text-default-400">
            {networkStatus.quality === "poor" ? (
              <WifiOff className="w-3.5 h-3.5" />
            ) : (
              <Wifi className="w-3.5 h-3.5" />
            )}
            <span>
              {networkStatus.effectiveType
                ? `${networkStatus.effectiveType.toUpperCase()} connection`
                : "Connection status unknown"}
              {recommendedQuality !== "original" &&
                effectiveQuality !== recommendedQuality &&
                ` · try ${QUALITY_LABELS[recommendedQuality] || recommendedQuality} for smoother playback`}
            </span>
          </div>
        )}
        {currentVideo && availableQualities.length > 1 && (
          <Select
            aria-label="Video quality"
            size="sm"
            className="w-48"
            selectedKeys={[effectiveQuality]}
            onSelectionChange={(keys) => {
              const value = Array.from(keys)[0] as string | undefined;
              if (value) handleQualityChange(value);
            }}
          >
            {availableQualities.map((q) => (
              <SelectItem key={q}>{QUALITY_LABELS[q] || q}</SelectItem>
            ))}
          </Select>
        )}
        <span className="text-sm">Total Video: {chaptersData?.length}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Video Player */}
        <div
          className="relative pt-[50.25%] w-full rounded-lg overflow-hidden md:col-span-2 bg-black"
          onContextMenu={(e) => e.preventDefault()} // disables right-click
        >
          {currentVideo ? (
            <video
              ref={videoRef}
              key={`${currentVideo._id}-${videoRetryKey}`}
              src={getUniversityAssetUrl(activeVideoUrl)}
              className="absolute top-0 left-0 w-full h-full"
              controlsList="nodownload"
              controls
              onLoadedData={() => setIsVideoLoading(false)}
              onLoadedMetadata={handleLoadedMetadata}
              onWaiting={() => setIsVideoLoading(true)}
              onPlaying={() => setIsVideoLoading(false)}
              onError={() => {
                setIsVideoLoading(false);
                setHasVideoError(true);
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-textPrimary">
              No videos available for this course yet.
            </div>
          )}

          {currentVideo && isVideoLoading && !hasVideoError && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 pointer-events-none">
              <Spinner size="lg" color="primary" />
            </div>
          )}

          {currentVideo && hasVideoError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/90 text-white text-center px-4">
              <span>This video couldn&apos;t be loaded.</span>
              <Button
                size="sm"
                color="primary"
                startContent={<RotateCw className="w-4 h-4" />}
                onPress={() => setVideoRetryKey((key) => key + 1)}
              >
                Retry
              </Button>
            </div>
          )}
        </div>

        {/* Chapter List */}
        <Card className="h-fit bg-bgSecondary">
          <CardHeader className="text-white">
            <h2 className="text-lg font-semibold">{courseDetails?.title}</h2>
          </CardHeader>
          <CardBody className="bg-bgSecondary text-textPrimary">
            <div className="flex flex-col gap-2">
              {chaptersData &&
                chaptersData.map((chapter) => {
                  const isCurrentVideo = currentVideo?._id === chapter._id;
                  return (
                    <Button
                      onPress={() => setCurrentVideo(chapter)}
                      key={chapter._id}
                      variant={isCurrentVideo ? "faded" : "light"}
                      color={isCurrentVideo ? "warning" : "default"}
                      className="justify-start gap-2 p-2 h-auto text-left"
                    >
                      <div className="flex items-center justify-between w-full">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <PlayCircle className="w-5 h-5 shrink-0" />
                          <span className="truncate block">{chapter.name}</span>
                        </div>
                        <Chip
                          size="sm"
                          color={
                            isCurrentVideo
                              ? "warning"
                              : hasWatched
                              ? "warning"
                              : "success"
                          }
                          variant="flat"
                        >
                          {isCurrentVideo
                            ? "watching"
                            : hasWatched
                            ? "Watched"
                            : "New"}
                        </Chip>
                      </div>
                    </Button>
                  );
                })}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
