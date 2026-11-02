import React from "react"

import { Frame } from "./frame"
import { FilesSlide } from "./slides/files"
import { FlowSlide } from "./slides/flow"
import { CloseSlide, CoverSlide, PointsSlide, QuoteSlide, SaveSlide } from "./slides/simple"
import type { Brand, Slide } from "./spec"

const Content: React.FC<{ slide: Slide; brand: Brand }> = ({ slide, brand }) => {
  switch (slide.type) {
    case "cover":
      return <CoverSlide slide={slide} />
    case "points":
      return <PointsSlide slide={slide} />
    case "quote":
      return <QuoteSlide slide={slide} />
    case "flow":
      return <FlowSlide slide={slide} />
    case "files":
      return <FilesSlide slide={slide} />
    case "save":
      return <SaveSlide slide={slide} />
    case "close":
      return <CloseSlide slide={slide} brand={brand} />
  }
}

export type SlideProps = { slide: Slide; series: string; index: number; total: number; brand: Brand }

export const SlideView: React.FC<SlideProps> = ({ slide, series, index, total, brand }) => (
  <Frame series={series} index={index} total={total} brand={brand} swipe={slide.type === "cover"}>
    <Content slide={slide} brand={brand} />
  </Frame>
)
