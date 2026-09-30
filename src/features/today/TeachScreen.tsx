/**
 * Learn by Teaching on its own screen (the `teach` tab). TeachSection was written
 * for the Massey tracker and its styles are scoped under `.pt-root`, so it gets the
 * same wrapper and stylesheet here. It lives in its own lazy chunk with them.
 */
import { useEffect } from 'preact/hooks';
import { TeachSection } from '@/features/teaching/TeachSection';
import { ensureToday } from '@/features/studytracker/trackerStore';
import '@/features/studytracker/studytracker.css';

export function TeachScreen() {
  // Teaching XP banks into the tracker's day, so roll that day over first, as the
  // tracker screen does on open.
  useEffect(() => {
    ensureToday();
  }, []);
  return (
    <div class="pt-root">
      <div class="wrap">
        <TeachSection standalone />
      </div>
    </div>
  );
}
