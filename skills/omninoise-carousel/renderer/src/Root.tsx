import React from "react"
import { Still } from "remotion"

import "./fonts"
import { SlideView, type SlideProps } from "./slide"
import { SIZE } from "./spec"

/**
 * One composition for every slide of every post. `render-post` renders it once per slide with
 * `--props`, so a workspace's posts never have to be bundled into the renderer. Studio shows
 * the sample below; open it with `bun run studio -- --props=<file>` to preview your own slide.
 */
const SAMPLE: SlideProps = {
  slide: { type: "cover", title: ["Three layers", "between your agent", "and **main**"], sub: "A worktree per agent, then a guard." },
  series: "Example series",
  index: 1,
  total: 6,
  brand: { name: "Example Channel", footer: "example.com/links" },
}

export const RemotionRoot: React.FC = () => (
  <Still id="Slide" component={SlideView} defaultProps={SAMPLE} width={SIZE.width} height={SIZE.height} />
)
