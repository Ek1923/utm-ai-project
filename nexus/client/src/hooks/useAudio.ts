import { useRef, useState } from 'react';

export function useAudio() {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFetching, setIsFetching] = useState(false);

  const play = async (text: string) => {
    setIsFetching(true);
    try {
      const response = await fetch(`/api/voice/stream?text=${encodeURIComponent(text)}`);
      if (!response.ok) throw new Error('Voice generation failed');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      if (!audioRef.current) {
        audioRef.current = new Audio();
      }

      audioRef.current.src = url;
      audioRef.current.onplay = () => setIsPlaying(true);
      audioRef.current.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(url);
      };

      await audioRef.current.play();
    } catch (err) {
      console.error('[AUDIO ERROR]', err);
    } finally {
      setIsFetching(false);
    }
  };

  const stop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  };

  return { play, stop, isPlaying, isFetching };
}
