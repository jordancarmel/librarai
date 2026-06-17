import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { Book } from '../types';

function gradientFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `linear-gradient(135deg, hsl(${hue} 65% 35%) 0%, hsl(${(hue + 50) % 360} 55% 25%) 100%)`;
}

interface BookCoverProps {
  book: Book;
  className?: string;
  rounded?: string;
}

export function BookCover({ book, className = '', rounded = 'rounded-xl' }: BookCoverProps) {
  const [failed, setFailed] = useState(false);
  const showImage = book.thumbnail && !failed;

  if (showImage) {
    return (
      <img
        src={book.thumbnail}
        alt={book.title}
        loading="lazy"
        onError={() => setFailed(true)}
        className={`h-full w-full object-cover ${rounded} ${className}`}
        dir="ltr"
      />
    );
  }

  return (
    <div
      className={`flex h-full w-full flex-col justify-between p-3 text-white ${rounded} ${className}`}
      style={{ background: gradientFor(book.title) }}
      dir={book.isHebrew ? 'rtl' : 'ltr'}
    >
      <BookOpen className="h-4 w-4 opacity-60" />
      <div>
        <p className="line-clamp-3 text-[11px] font-semibold leading-tight">{book.title}</p>
        {book.authors[0] && (
          <p className="mt-1 line-clamp-1 text-[10px] opacity-80">{book.authors[0]}</p>
        )}
      </div>
    </div>
  );
}
