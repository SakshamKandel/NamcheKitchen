'use client';

import Cropper, { type Area, type MediaSize, type Point, type Size } from 'react-easy-crop';
import { RotateCcw, RotateCw } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createCroppedImage } from '@/lib/crop-image';
import styles from './ImageCropper.module.css';

type Shape = '4:3' | '1:1' | '16:9' | '3:4' | 'original';
const ratios = { '4:3': 4 / 3, '1:1': 1, '16:9': 16 / 9, '3:4': 3 / 4 };
const limitZoom = (value: number) => Math.max(1, Math.min(5, value));

export default function ImageCropper({ src, onCancel, onComplete }: {
  src: string;
  onCancel: () => void;
  onComplete: (blob: Blob) => void;
}) {
  const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [shape, setShape] = useState<Shape>('4:3');
  const [rotation, setRotation] = useState(0);
  const [media, setMedia] = useState<MediaSize | null>(null);
  const [frame, setFrame] = useState<Size | null>(null);
  const [area, setArea] = useState<Area | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editor = useRef<HTMLDivElement>(null);
  const shapeInput = useRef<HTMLSelectElement>(null);

  const recordMedia = useCallback((value: MediaSize) => {
    setMedia(current => current?.width === value.width && current.height === value.height && current.naturalWidth === value.naturalWidth && current.naturalHeight === value.naturalHeight ? current : value);
  }, []);
  const recordFrame = useCallback((value: Size) => {
    setFrame(current => current?.width === value.width && current.height === value.height ? current : value);
  }, []);

  const turned = rotation % 180 !== 0;
  const aspect = shape === 'original'
    ? media ? (turned ? media.naturalHeight / media.naturalWidth : media.naturalWidth / media.naturalHeight) : 4 / 3
    : ratios[shape];
  // 100% is the widest view filling the frame after a turn or viewport resize.
  const fitZoom = media && frame
    ? Math.max(frame.width / (turned ? media.height : media.width), frame.height / (turned ? media.width : media.height))
    : 1;
  const ready = Boolean(media && frame && area);

  useEffect(() => { if (ready) shapeInput.current?.focus(); }, [ready]);

  function resetView() {
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setError('');
  }

  function turn(degrees: number) {
    setRotation(value => (value + degrees + 360) % 360);
    resetView();
  }

  async function finish() {
    if (!area || busy) return;
    setBusy(true);
    setError('');
    try {
      onComplete(await createCroppedImage(src, area, rotation));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not prepare this image.');
    } finally {
      setBusy(false);
    }
  }

  return <div ref={editor} className={`crop-editor ${styles.editor}`} role="dialog" aria-modal="true" aria-label="Crop menu image" onKeyDown={event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!busy) onCancel();
    } else if (event.key === 'Tab') {
      const controls = editor.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]');
      if (!controls?.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }}>
    <div className={`crop-stage ${styles.stage}`}>
      <Cropper
        image={src}
        crop={crop}
        zoom={fitZoom * zoom}
        minZoom={fitZoom}
        maxZoom={fitZoom * 5}
        rotation={rotation}
        aspect={aspect}
        objectFit="contain"
        style={{ mediaStyle: { width: 'auto', height: 'auto', objectFit: 'contain', backgroundColor: '#ffffff' }, containerStyle: { pointerEvents: busy ? 'none' : undefined } }}
        onCropChange={value => { if (!busy) setCrop(value); }}
        onZoomChange={value => { if (!busy) setZoom(limitZoom(value / fitZoom)); }}
        onCropComplete={(_, pixels) => setArea(pixels)}
        setMediaSize={recordMedia}
        onCropSizeChange={recordFrame}
      />
    </div>

    <div className={styles.tools}>
      <label className={styles.shape}>Crop shape
        <select ref={shapeInput} aria-label="Crop shape" value={shape} disabled={busy || !ready} onChange={event => { setShape(event.target.value as Shape); resetView(); }}>
          <option value="4:3">Menu landscape (4:3)</option>
          <option value="1:1">Square (1:1)</option>
          <option value="16:9">Wide (16:9)</option>
          <option value="3:4">Portrait (3:4)</option>
          <option value="original">Original photo shape</option>
        </select>
      </label>
      <div className={styles.rotations} role="group" aria-label="Rotate photo">
        <button type="button" aria-label="Rotate left" title="Rotate left 90 degrees" disabled={busy || !ready} onClick={() => turn(-90)}><RotateCcw size={17} />90°</button>
        <button type="button" aria-label="Rotate right" title="Rotate right 90 degrees" disabled={busy || !ready} onClick={() => turn(90)}><RotateCw size={17} />90°</button>
      </div>
      <button className={styles.fullPhoto} type="button" disabled={busy || !ready} onClick={() => { setShape('original'); resetView(); }}>Keep full photo</button>
    </div>

    <div className={`crop-zoom ${styles.zoom}`}>
      <label htmlFor="menu-image-zoom">Zoom</label>
      <button type="button" aria-label="Zoom out" disabled={busy || !ready || zoom <= 1} onClick={() => setZoom(value => limitZoom(value - 0.1))}>−</button>
      <input id="menu-image-zoom" type="range" aria-label="Zoom" min={1} max={5} step={0.05} value={zoom} aria-valuetext={`${Math.round(zoom * 100)}%`} disabled={busy || !ready} onChange={event => setZoom(Number(event.target.value))} />
      <button type="button" aria-label="Zoom in" disabled={busy || !ready || zoom >= 5} onClick={() => setZoom(value => limitZoom(value + 0.1))}>+</button>
      <span aria-hidden="true">{Math.round(zoom * 100)}%</span>
    </div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className={`editor-actions ${styles.actions}`}>
      <button type="button" className="button" onClick={onCancel} disabled={busy}>Cancel</button>
      <button type="button" className="button" disabled={busy || !ready} onClick={resetView}>Reset view</button>
      <button type="button" className="button dark" onClick={finish} disabled={busy || !ready}>{busy ? 'Preparing…' : 'Use this crop'}</button>
    </div>
  </div>;
}
