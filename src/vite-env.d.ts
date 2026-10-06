/// <reference types="vite/client" />

// Tipos mínimos para APIs de cámara que no están en la lib DOM de TypeScript.
interface DetectedBarcode { rawValue: string; format: string }
interface BarcodeDetector { detect(source: CanvasImageSource): Promise<DetectedBarcode[]> }
declare const BarcodeDetector: {
  new (options?: { formats?: string[] }): BarcodeDetector
  getSupportedFormats(): Promise<string[]>
} | undefined
interface MediaTrackCapabilities { torch?: boolean }
interface MediaTrackConstraintSet { torch?: boolean }
