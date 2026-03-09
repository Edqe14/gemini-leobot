import { useState, useCallback } from 'react';
import { X, Save } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ImageRefResult = {
  id: string;
  pageUrl: string;
  srcMedium: string;
  srcLarge: string;
  photographer: string;
  photographerUrl: string;
  alt: string;
  licenseUrl?: string;
};

export type ImageRefPanelState = {
  nodeId: string;
  nodeType: 'character' | 'storyboard';
  query: string;
  results: ImageRefResult[];
};

type Props = {
  panel: ImageRefPanelState;
  saving: boolean;
  onClose: () => void;
  onSave: (
    nodeId: string,
    nodeType: 'character' | 'storyboard',
    urls: string[],
  ) => void;
};

export function ImageReferencesPanel({
  panel,
  saving,
  onClose,
  onSave,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    const urls = panel.results
      .filter((r) => selected.has(r.id))
      .map((r) => r.srcLarge);
    onSave(panel.nodeId, panel.nodeType, urls);
  }, [panel.results, panel.nodeId, panel.nodeType, selected, onSave]);

  return (
    <div className='fixed right-6 top-20 z-50 flex w-[520px] max-h-[calc(100vh-120px)] flex-col rounded-xl border-2 border-black bg-white shadow-[4px_4px_0_#1A1A1A]'>
      {/* Header */}
      <div className='flex items-center justify-between border-b-2 border-black bg-[#FFE234] px-4 py-3 rounded-t-[10px]'>
        <div className='min-w-0'>
          <p className='text-xs font-bold uppercase tracking-wide text-black/60'>
            Image References · {panel.nodeType}
          </p>
          <p className='truncate font-mono text-sm font-black text-black'>
            "{panel.query}"
          </p>
        </div>
        <button
          type='button'
          onClick={onClose}
          className='ml-3 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border-2 border-black bg-white hover:bg-[#EDEAD9] shadow-[2px_2px_0_#1A1A1A]'>
          <X className='h-4 w-4' />
        </button>
      </div>

      {/* Image grid */}
      <div className='min-h-0 flex-1 overflow-y-auto p-3'>
        {panel.results.length === 0 ? (
          <p className='py-8 text-center font-mono text-sm text-muted-foreground'>
            No results found.
          </p>
        ) : (
          <div className='grid grid-cols-3 gap-2'>
            {panel.results.map((photo) => {
              const isSelected = selected.has(photo.id);
              return (
                <button
                  key={photo.id}
                  type='button'
                  onClick={() => toggle(photo.id)}
                  title={photo.alt || photo.photographer}
                  className={cn(
                    'group relative aspect-video overflow-hidden rounded-lg border-2 transition',
                    isSelected
                      ? 'border-black shadow-[2px_2px_0_#1A1A1A]'
                      : 'border-transparent hover:border-black/40',
                  )}>
                  <img
                    src={photo.srcMedium}
                    alt={photo.alt || `Photo by ${photo.photographer}`}
                    className='h-full w-full object-cover'
                    loading='lazy'
                  />
                  {/* Selection overlay */}
                  <div
                    className={cn(
                      'absolute inset-0 flex items-center justify-center transition',
                      isSelected
                        ? 'bg-black/30'
                        : 'bg-transparent group-hover:bg-black/10',
                    )}>
                    {isSelected && (
                      <div className='flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-black'>
                        <svg
                          className='h-3 w-3 text-white'
                          viewBox='0 0 12 12'
                          fill='none'
                          stroke='currentColor'
                          strokeWidth='2'>
                          <polyline points='2,6 5,9 10,3' />
                        </svg>
                      </div>
                    )}
                  </div>
                  {/* Photographer on hover */}
                  <div className='absolute bottom-0 left-0 right-0 translate-y-full bg-black/70 px-1.5 py-1 transition-transform group-hover:translate-y-0'>
                    <p className='truncate font-mono text-[9px] text-white'>
                      {photo.photographer}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className='flex items-center justify-between border-t-2 border-black px-4 py-3'>
        <a
          href='https://pixabay.com'
          target='_blank'
          rel='noopener noreferrer'
          className='font-mono text-[11px] text-muted-foreground underline hover:text-foreground'>
          Photos from Pixabay
        </a>
        <button
          type='button'
          disabled={selected.size === 0 || saving}
          onClick={handleSave}
          className={cn(
            'flex items-center gap-2 rounded-lg border-2 border-black px-3 py-1.5 font-mono text-xs font-bold shadow-[2px_2px_0_#1A1A1A] transition',
            selected.size > 0 && !saving
              ? 'bg-[#CCFF00] hover:bg-[#b8f000]'
              : 'bg-white opacity-50 cursor-not-allowed',
          )}>
          <Save className='h-3.5 w-3.5' />
          {saving ? 'Saving…' : `Save selected (${selected.size})`}
        </button>
      </div>
    </div>
  );
}
