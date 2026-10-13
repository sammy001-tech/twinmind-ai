import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause } from 'lucide-react';

interface VoicePlayerProps {
  audioUrl: string;
  theme?: 'web' | 'telegram' | 'whatsapp';
  autoPlay?: boolean;
}

export const VoicePlayer: React.FC<VoicePlayerProps> = ({ audioUrl, theme = 'web', autoPlay = false }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(() => {
    const saved = localStorage.getItem('twin_voice_speed');
    const parsed = saved ? parseFloat(saved) : 1;
    return [0.75, 1, 1.25, 1.5, 2].includes(parsed) ? parsed : 1;
  });
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.playbackRate = playbackRate;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => {
      setDuration(audio.duration || 0);
      if (autoPlay) {
        audio.play().then(() => setIsPlaying(true)).catch(() => {
          // Autoplay policy prevented playback, requires user interaction
        });
      }
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(0);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [audioUrl, autoPlay]);

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.playbackRate = playbackRate;
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const cyclePlaybackRate = () => {
    const rates = [0.75, 1, 1.25, 1.5, 2];
    const nextIdx = (rates.indexOf(playbackRate) + 1) % rates.length;
    const nextRate = rates[nextIdx];
    if (audioRef.current) {
      audioRef.current.playbackRate = nextRate;
    }
    setPlaybackRate(nextRate);
    localStorage.setItem('twin_voice_speed', String(nextRate));
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setCurrentTime(time);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs === 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Channel-adaptive accents
  const isTG = theme === 'telegram';
  const isWA = theme === 'whatsapp';

  const btnBg = isTG
    ? 'bg-sky-500 hover:bg-sky-600 text-white'
    : isWA
    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
    : 'bg-indigo-600 hover:bg-indigo-700 text-white';

  const containerBg = isTG
    ? 'bg-sky-950/40 border-sky-800/50 text-sky-100'
    : isWA
    ? 'bg-emerald-950/40 border-emerald-800/50 text-emerald-100'
    : 'bg-slate-100 dark:bg-slate-900/60 border-slate-200 dark:border-slate-700/60 text-slate-800 dark:text-slate-200';

  return (
    <div className={`mt-2 flex items-center gap-3 p-2.5 rounded-xl border backdrop-blur-sm ${containerBg}`}>
      <audio ref={audioRef} src={audioUrl} preload="metadata" />

      <button
        type="button"
        onClick={togglePlay}
        className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-sm transition-all ${btnBg}`}
        aria-label={isPlaying ? 'Pause voice message' : 'Play voice message'}
      >
        {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
      </button>

      {/* Live Audio Playback Progress Bar & Waveform */}
      <div className="flex-1 flex flex-col gap-1 min-w-[120px]">
        <div className="flex items-center gap-1.5 h-4 px-1">
          {[40, 70, 30, 90, 60, 45, 80, 55, 30, 75, 95, 60, 40, 85, 50, 70, 30, 65].map((height, i) => {
            const progressRatio = duration > 0 ? currentTime / duration : 0;
            const barRatio = i / 18;
            const active = barRatio <= progressRatio;
            return (
              <span
                key={i}
                className={`w-1 rounded-full transition-all duration-150 ${
                  active
                    ? isTG
                      ? 'bg-sky-400'
                      : isWA
                      ? 'bg-emerald-400'
                      : 'bg-indigo-500 dark:bg-indigo-400'
                    : 'bg-slate-300 dark:bg-slate-600/40'
                }`}
                style={{ height: `${Math.max(4, (height / 100) * 16)}px` }}
              />
            );
          })}
        </div>

        <div className="flex items-center justify-between text-xs opacity-75 font-mono px-0.5">
          <span>{formatTime(currentTime)}</span>
          <input
            type="range"
            min="0"
            max={duration || 1}
            step="0.1"
            value={currentTime}
            onChange={handleSeek}
            className="w-24 h-1 accent-indigo-500 cursor-pointer opacity-50 hover:opacity-100 transition-opacity"
          />
          <span>{duration > 0 ? formatTime(duration) : 'Voice note'}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={cyclePlaybackRate}
        className="text-[11px] font-semibold px-2 py-0.5 rounded border border-slate-300 dark:border-white/10 hover:border-slate-400 dark:hover:border-white/30 text-slate-700 dark:text-slate-200 bg-white/60 dark:bg-transparent transition text-xs shrink-0"
        title="Cycle speed (0.75x, 1x, 1.25x, 1.5x, 2x)"
      >
        {playbackRate}x
      </button>
    </div>
  );
};
