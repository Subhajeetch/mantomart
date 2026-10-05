"use client";

import { useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { ImagePlus, Loader2, Pencil, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import { toast } from "@/components/ui/toast";
import { useMediaQuery } from "@/hooks/use-media-query";
import { uploadProfileImage } from "../api";
import type { ConsumerProfile } from "../types";

const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_WEBP_BYTES = 30 * 1024;
const ACCEPTED_TYPES = new Map([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

type ProfileImageEditorProps = {
  onSaved: (profile: ConsumerProfile) => void;
  children: React.ReactNode;
};

export function ProfileImageEditor({ onSaved, children }: ProfileImageEditorProps) {
  const [open, setOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen && uploadingRef.current) return;
    setOpen(nextOpen);
  }

  const uploadingRef = useRef(false);
  const trigger = (
    <Button
      type="button"
      variant="secondary"
      size="icon-sm"
      className="absolute -right-1 -bottom-1 rounded-full border border-background shadow-sm"
      aria-label="Edit profile image"
    >
      <Pencil className="size-3.5" />
    </Button>
  );
  const avatarTrigger = (
    <button
      type="button"
      className="group/avatar absolute inset-0 z-0 flex size-full items-center justify-center overflow-hidden rounded-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      aria-label="Edit profile image"
    >
      {children}
      <span className="absolute inset-0 bg-black/0 transition-colors group-hover/avatar:bg-black/25 group-focus-visible/avatar:bg-black/25" />
    </button>
  );

  if (isDesktop) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogTrigger render={avatarTrigger} />
        <DialogTrigger render={trigger} />
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit profile picture</DialogTitle>
            <DialogDescription>
              Update your Profile picture.
            </DialogDescription>
          </DialogHeader>
          <ProfileImageForm
            key={String(open)}
            onSaved={onSaved}
            onUploadingChange={(uploading) => {
              uploadingRef.current = uploading;
            }}
            onCancel={() => setOpen(false)}
          />
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerTrigger render={avatarTrigger} />
      <DrawerTrigger render={trigger} />
      <DrawerContent>
        <DrawerHeader className="text-left">
          <DrawerTitle>Edit profile image</DrawerTitle>
          <DrawerDescription>
             Update your Profile picture.
          </DrawerDescription>
        </DrawerHeader>
        <ProfileImageForm
          key={String(open)}
          className="p-4"
          onSaved={onSaved}
          onUploadingChange={(uploading) => {
            uploadingRef.current = uploading;
          }}
          onCancel={() => setOpen(false)}
        />
      </DrawerContent>
    </Drawer>
  );
}

function ProfileImageForm({
  className = "",
  onSaved,
  onCancel,
  onUploadingChange,
}: {
  className?: string;
  onSaved: (profile: ConsumerProfile) => void;
  onCancel: () => void;
  onUploadingChange: (uploading: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function showError(message: string) {
    setError(message);
    toast.add({ title: "Image not uploaded", description: message, type: "error" });
  }

  async function chooseFile(nextFile: File | undefined) {
    if (!nextFile) return;
    setError(null);

    if (nextFile.size > MAX_SOURCE_BYTES) {
      setFile(null);
      setCroppedArea(null);
      showError("Choose an image that is 8 MB or smaller.");
      return;
    }

    const extension = nextFile.name.toLowerCase().match(/\.[^.]+$/)?.[0];
    const expectedType = extension ? ACCEPTED_TYPES.get(extension) : undefined;
    if (!expectedType || nextFile.type.toLowerCase() !== expectedType) {
      setFile(null);
      setCroppedArea(null);
      showError("Use a JPEG, PNG, or WebP image.");
      return;
    }

    try {
      const bitmap = await createImageBitmap(nextFile);
      const dimensionsAreSafe = bitmap.width > 0 && bitmap.height > 0;
      bitmap.close();
      if (!dimensionsAreSafe) {
        setFile(null);
        setCroppedArea(null);
        showError("The selected image has invalid dimensions.");
        return;
      }
    } catch {
      setFile(null);
      setCroppedArea(null);
      showError("This image could not be opened. Choose a valid JPEG, PNG, or WebP file.");
      return;
    }

    setFile(nextFile);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
  }

  async function saveImage() {
    if (!imageUrl || !croppedArea || uploading) return;
    setError(null);
    setUploading(true);
    onUploadingChange(true);
    setProgress(0);

    try {
      const croppedImage = await createCroppedWebp(imageUrl, croppedArea);
      const updatedProfile = await uploadProfileImage(croppedImage, setProgress);
      onSaved(updatedProfile);
      toast.add({
        title: "Profile image updated",
        description: "Your new profile image has been saved.",
      });
      onCancel();
    } catch (reason) {
      showError(reason instanceof Error ? reason.message : "Unable to upload your profile image.");
    } finally {
      setUploading(false);
      onUploadingChange(false);
    }
  }

  const chooseButton = () => inputRef.current?.click();

  return (
    <div className={`grid gap-5 ${className}`}>
      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(event) => {
          void chooseFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
        aria-label="Choose a profile image"
      />

      {imageUrl ? (
        <>
          <div className="relative h-64 overflow-hidden rounded-lg bg-muted">
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              minZoom={1}
              maxZoom={3}
              aspect={1}
              cropShape="rect"
              objectFit="vertical-cover"
              showGrid
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={(_area, pixels) => setCroppedArea(pixels)}
            />
          </div>
          <label className="grid gap-2 text-xs text-muted-foreground">
            Zoom
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              disabled={uploading}
              aria-label="Zoom image"
              className="w-full accent-foreground"
            />
          </label>
          <Button type="button" variant="outline" onClick={chooseButton} disabled={uploading}>
            <ImagePlus />
            Choose a different image
          </Button>
        </>
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={chooseButton}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              chooseButton();
            }
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void chooseFile(event.dataTransfer.files[0]);
          }}
          className={`flex min-h-52 cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-5 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
            dragging ? "border-foreground bg-muted" : "border-border hover:bg-muted/50"
          }`}
        >
          <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Upload className="size-5" />
          </span>
          <span className="text-sm font-medium">Drop an image here or browse</span>
          <span className="text-xs text-muted-foreground">
            JPEG, PNG, or WebP · up to 8 MB
          </span>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {uploading && (
        <AttachmentGroup className="w-full" aria-live="polite">
          <Attachment state="uploading" className="w-full">
            <AttachmentMedia variant="image">
              {imageUrl && <img src={imageUrl} alt="Profile image being uploaded" />}
              <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white">
                <Loader2 className="size-5 animate-spin" aria-hidden="true" />
              </span>
            </AttachmentMedia>
            <AttachmentContent>
              <AttachmentTitle>profile-image.webp</AttachmentTitle>
              <AttachmentDescription>
                {progress === 100 ? "Finishing upload…" : `Uploading · ${progress}%`}
              </AttachmentDescription>
            </AttachmentContent>
          </Attachment>
        </AttachmentGroup>
      )}

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={uploading}>
          Cancel
        </Button>
        <Button type="button" onClick={() => void saveImage()} disabled={!croppedArea || uploading}>
          {uploading && <Loader2 className="animate-spin" />}
          {uploading ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

async function createCroppedWebp(imageUrl: string, area: Area): Promise<Blob> {
  const image = new Image();
  image.src = imageUrl;
  await image.decode();

  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 200;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser could not prepare the cropped image.");

  context.drawImage(
    image,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    canvas.width,
    canvas.height
  );

  for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42, 0.32]) {
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", quality);
    });
    if (!blob || blob.type !== "image/webp") {
      throw new Error("Your browser could not convert this image to WebP.");
    }
    if (blob.size <= MAX_WEBP_BYTES) return blob;
  }

  throw new Error("This image could not be optimized below 30 KB. Choose another image.");
}
