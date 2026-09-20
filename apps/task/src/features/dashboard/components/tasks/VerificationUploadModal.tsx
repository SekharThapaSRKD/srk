import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Send, Upload, X } from 'lucide-react';
import { allPlatforms } from '../../../../data/dummyDashboardMockData';
import { DashboardGlassCard } from '../ui/DashboardGlassCard';
import MagneticButton from '../ui/DashboardMagneticButton';
import { api } from '../../../../lib/api';
import { useTaskAuthStore } from '../../../../store/useTaskAuthStore';
// Sending image data URLs to backend; backend middleware will upload to R2
import { Task } from '../../types';

interface VerificationUploadModalProps {
  task: Task
  onClose: () => void;
  addNotification: (
    message: string,
    type: 'success' | 'error' | 'info'
  ) => void;
  completeTask: (taskId: string) => void;
}

export const VerificationUploadModal: React.FC<
  VerificationUploadModalProps
> = ({ task, onClose, addNotification, completeTask }) => {
  const [screenshot, setScreenshot] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const overallProgress = 0;
  const activeUploads: any[] = [];
  const { taskUserID } = useTaskAuthStore();
  const submitAction = api.srkTask.srkTaskActionSubmission.useMutation();
  const queryClient = useQueryClient();

  // The task list is cached per platform/type; drop the submitted task from every
  // cached list so reopening the list can never show it again, even if the
  // background refetch is slow, then refetch to resync totals.
  const removeTaskFromCachedLists = () => {
    queryClient.setQueriesData(
      { queryKey: ['getSrkTaskActionsByPlatforms'] },
      (old: any) =>
        old?.status === 200 && Array.isArray(old.body?.data)
          ? {
              ...old,
              body: {
                ...old.body,
                data: old.body.data.filter(
                  (item: any) => item?.actionId !== task.id
                ),
                totalRecords: Math.max(0, (old.body.totalRecords ?? 1) - 1),
              },
            }
          : old
    );
    queryClient.invalidateQueries({
      queryKey: ['getSrkTaskActionsByPlatforms'],
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        setUploadError('File size exceeds 10MB. Please choose a smaller file.');
        return;
      }
      
      // Validate file type
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        setUploadError('Only JPG, PNG, and WebP formats are supported.');
        return;
      }

      setUploadError(null);
      setScreenshot(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    if (!screenshot) {
      addNotification('Please upload a screenshot first', 'error');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      // Send the image data URL directly to backend; middleware will handle upload
      submitAction.mutate(
        {
          body: {
            actionTodoId: task.id,
            srkTaskUserId: taskUserID || '',
            actionVerificationImageUrl: preview, // data URL
          },
        },
        {
          onSuccess: () => {
            setIsUploading(false);
            removeTaskFromCachedLists();
            completeTask(task.id);
            addNotification(`✅ Proof submitted for ${task.type} task`, 'success');
            setTimeout(() => onClose(), 1500);
          },
          onError: (error: any) => {
            setIsUploading(false);
            const errorMsg = error?.body?.message || 'Unknown error';
            // The server already has this submission (e.g. the list was stale, or
            // an earlier attempt succeeded but the response was lost). Not an
            // error for the user: remove the task and close instead of a red error.
            if (/already submitted/i.test(errorMsg)) {
              removeTaskFromCachedLists();
              addNotification(
                'You have already submitted this task. It has been removed from your list.',
                'info'
              );
              setTimeout(() => onClose(), 1000);
              return;
            }
            setUploadError(errorMsg);
            addNotification(`Submission failed: ${errorMsg}`, 'error');
          },
        }
      );
    } catch (error: any) {
      setIsUploading(false);
      const errorMsg = error.message || 'Submission failed';
      setUploadError(errorMsg);
      addNotification(`Submission failed: ${errorMsg}`, 'error');
    }
  };

  const platformInfo = allPlatforms.find((p) => p.platform === task.platform);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/90 backdrop-blur-sm overflow-y-auto">
      <DashboardGlassCard className="w-full max-w-2xl my-auto relative max-h-[90vh] flex flex-col overflow-scroll">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 sm:top-6 sm:right-6 p-2 hover:bg-white/10 rounded-lg z-10"
        >
          <X size={20} />
        </button>

        <div className="overflow-y-auto px-6 sm:px-8 py-6 sm:py-8">
          <div className="text-center mb-6 sm:mb-8">
            <div className="w-16 h-16 rounded-full bg-div-to-r from-amber-500/20 to-yellow-500/20 flex items-center justify-center mx-auto mb-4">
              <Upload size={28} className="text-amber-400" />
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Submit Proof</h2>
            <p className="text-zinc-400">Upload screenshot for verification</p>
          </div>

          <div className="space-y-6">
            {/* Task Info */}
            <DashboardGlassCard className="p-6">
              <div className="flex items-center gap-4 mb-4">
                <div
                  className={`w-12 h-12 rounded-xl bg-div-to-br ${platformInfo?.gradient} flex items-center justify-center`}
                >
                  {platformInfo?.icon &&
                    React.createElement(platformInfo.icon, {
                      size: 20,
                      className: platformInfo.color,
                    })}
                </div>
                <div>
                  <h4 className="font-bold text-white">{task.type?.toUpperCase() || ''} - {task.username || 'User'}</h4>
                  <p className="text-sm text-zinc-400">{task.platform || ''}</p>
                </div>
              </div>
              <p className="text-sm text-amber-400 bg-amber-500/10 p-3 rounded-lg">
                📸 {task.type === 'follow' ? 'Follow the profile' : 'Like the post'}
              </p>
              {/* visit link with good ui  */}
              {task.url && (
                <div className="mt-4">
                  <label className="block text-sm font-medium text-zinc-400 mb-2">
                    {task.type === 'like' ? 'Post Link' : 'Profile Link'}
                  </label>
                  <a
                    href={task.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-yellow-400 underline break-all"
                  >
                    {task.url || 'N/A'}
                  </a>
                </div>
              )}

            </DashboardGlassCard>

            {/* Error Message */}
            {uploadError && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl"
              >
                <p className="text-sm text-red-400 flex items-start gap-2">
                  <span>⚠️</span>
                  <span>{uploadError}</span>
                </p>
              </motion.div>
            )}

            {/* Upload Area */}
            <div>
              <label className="block text-sm font-medium text-zinc-400 mb-2">
                Upload Screenshot Proof
              </label>
              <div
                className={`border-2 border-dashed ${
                  uploadError
                    ? 'border-red-500/50'
                    : preview
                    ? 'border-amber-500/50'
                    : 'border-white/10'
                } rounded-xl p-8 text-center hover:border-amber-500/30 transition-colors cursor-pointer ${
                  isUploading ? 'pointer-events-none opacity-60' : ''
                }`}
                onClick={() =>
                  !isUploading &&
                  document.getElementById('screenshot-upload')?.click()
                }
              >
                <input
                  type="file"
                  id="screenshot-upload"
                  onChange={handleFileUpload}
                  className="hidden"
                  accept=".jpg,.jpeg,.png,.webp"
                  disabled={isUploading}
                />

                {preview ? (
                  <div className="space-y-4">
                    <img
                      src={preview}
                      alt="Screenshot preview"
                      className="max-h-48 mx-auto rounded-lg object-contain"
                    />
                    <p className="text-sm text-amber-400">
                      ✅ Screenshot ready for submission ({(screenshot?.size || 0) / 1024 / 1024}MB)
                    </p>
                    {!isUploading && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setScreenshot(null);
                          setPreview(null);
                          setUploadError(null);
                        }}
                        className="text-sm text-red-400 hover:text-red-300"
                      >
                        × Remove
                      </button>
                    )}
                  </div>
                ) : (
                  <>
                    <Upload size={40} className="mx-auto mb-4 text-zinc-400" />
                    <p className="text-zinc-400 mb-2">
                      Click to upload screenshot
                    </p>
                    <p className="text-xs text-zinc-500">
                      JPG, PNG, WebP • Max 10MB
                    </p>
                  </>
                )}
              </div>
            </div>

            {/* Upload Progress */}
            {isUploading && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-3 bg-amber-500/10 border border-amber-500/20 rounded-xl p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="animate-spin">⚙️</div>
                    <span className="text-sm font-medium text-amber-400">
                      Uploading to Firebase...
                    </span>
                  </div>
                  <span className="text-sm font-bold text-amber-400">
                    {overallProgress}%
                  </span>
                </div>
                <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-amber-500 to-yellow-500"
                    initial={{ width: '0%' }}
                    animate={{ width: `${overallProgress}%` }}
                    transition={{ duration: 0.3 }}
                  />
                </div>
                <p className="text-xs text-zinc-400">
                  {overallProgress < 100
                    ? '📤 Compressing & uploading... If stuck at 0%, check your connection'
                    : '✅ Upload complete, processing submission...'}
                </p>
              </motion.div>
            )}

            {/* Submit Button */}
            <MagneticButton
              onClick={handleSubmit}
              disabled={!screenshot || isUploading || !!uploadError}
              className="w-full"
            >
              {isUploading ? (
                <span className="flex items-center justify-center gap-2">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity }}
                  >
                    <RefreshCw size={16} />
                  </motion.div>
                  {overallProgress < 100
                    ? `Uploading ${overallProgress}%...`
                    : 'Processing...'}
                </span>
              ) : uploadError ? (
                <span className="flex items-center justify-center gap-2">
                  ⚠️ Error - Try Again
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  <Send size={16} />
                  Submit Proof
                </span>
              )}
            </MagneticButton>
          </div>
        </div>
      </DashboardGlassCard>
    </div>
  );
};
