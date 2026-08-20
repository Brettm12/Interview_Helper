import type { MockCallFrameProps } from '../contracts'
import './live.css'

/** Demo wrapper: the reference frame's placeholder call area on the left,
 *  with the helper panel (children) docked in a 412px region on the right. */
export default function MockCallFrame(props: MockCallFrameProps): JSX.Element {
  const { headerLeft, timer, speakerPill, children } = props

  return (
    <div className="live-frame">
      <div className="live-frame__call">
        <div className="live-frame__callhead">
          <div className="live-frame__callhead-left">{headerLeft}</div>
          <div className="live-frame__timer">{timer}</div>
        </div>

        <div className="live-frame__main">
          <div className="live-frame__video-label">INTERVIEWER VIDEO</div>
          <div className="live-frame__pill">{speakerPill}</div>
        </div>

        <div className="live-frame__thumbs">
          <div className="live-frame__thumb live-frame__thumb--second">SECOND INTERVIEWER</div>
          <div className="live-frame__thumb live-frame__thumb--you">You</div>
          <div className="live-frame__thumb" />
        </div>

        <div className="live-frame__controls">
          <div className="live-frame__pillbtn">Mute</div>
          <div className="live-frame__pillbtn">Camera</div>
          <div className="live-frame__pillbtn">Share</div>
          <div className="live-frame__pillbtn live-frame__pillbtn--leave">Leave</div>
        </div>
      </div>

      <div className="live-frame__panel">{children}</div>
    </div>
  )
}
