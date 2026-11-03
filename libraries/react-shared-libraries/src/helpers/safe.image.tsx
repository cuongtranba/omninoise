'use client';

import { FC, ImgHTMLAttributes } from 'react';

type SafeImageProps = ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
};

const SafeImage: FC<SafeImageProps> = ({
  src,
  alt,
  width,
  height,
  className,
  style,
  ...rest
}) => {
  return (
    <img
      src={src}
      alt={alt || ''}
      width={typeof width === 'number' ? width : undefined}
      height={typeof height === 'number' ? height : undefined}
      className={className}
      style={style}
    />
  );
};

export default SafeImage;
