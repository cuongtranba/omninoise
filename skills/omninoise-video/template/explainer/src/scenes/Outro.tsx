import { Img, staticFile } from "remotion"

import { Pop, Slide } from "../components/kinetic"
import { Grain, Plate } from "../components/plate"
import { RADIUS, SIZE } from "../components/primitives"
import { Stage } from "../components/stage"
import { useCopy } from "../content/use-copy"
import { THEME } from "../generated/theme"
import { at } from "../timing"
import type { SceneComponent } from "./types"

// The end card: mark, name, handle and hub link land with the first sentence, the follow line with the second.
const CUE = { logo: 0, name: 0.04, handle: 0.12, link: 0.2, follow: 0.46 }

export const Scene: SceneComponent = ({ durationInFrames }) => {
  const { outro } = useCopy()

  return (
    <Stage
      name="Outro"
      background={
        <>
          <Plate src="hook.jpg" durationInFrames={durationInFrames} zoom={[1.2, 1.08]} pan={[20, -30]} dim={0.62} />
          <Grain />
        </>
      }
    >
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
          textAlign: "center",
        }}
      >
        <Pop at={at(CUE.logo, durationInFrames)} from={0.4} rotate={-12}>
          <Img src={staticFile("brand/logo.png")} style={{ width: 170, height: 170, borderRadius: 38 }} />
        </Pop>

        <Slide at={at(CUE.name, durationInFrames)} y={60}>
          <h1 style={{ margin: 0, fontSize: SIZE.heading, fontWeight: 700, lineHeight: 1.06, letterSpacing: "-0.02em" }}>{outro.heading}</h1>
        </Slide>

        <Slide at={at(CUE.handle, durationInFrames)} y={50}>
          <p style={{ margin: 0, fontSize: SIZE.lead, fontWeight: 600, color: THEME.accent }}>{outro.handle}</p>
        </Slide>

        <Pop at={at(CUE.link, durationInFrames)} from={0.8}>
          <p
            style={{
              margin: 0,
              fontSize: SIZE.mono,
              fontWeight: 600,
              color: THEME.foreground,
              border: `4px solid ${THEME.accent}`,
              borderRadius: RADIUS.lg,
              padding: "12px 30px 16px",
              whiteSpace: "nowrap",
            }}
          >
            {outro.link}
          </p>
        </Pop>

        <Slide at={at(CUE.follow, durationInFrames)} y={50}>
          <p style={{ margin: 0, fontSize: SIZE.body, fontWeight: 600, color: THEME.foreground, lineHeight: 1.2, textWrap: "balance" }}>{outro.subheading}</p>
        </Slide>
      </div>
    </Stage>
  )
}
