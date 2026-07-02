/**
 * WebRTC 音频低延迟：Opus SDP 调优 + 接收端 jitterBufferTarget
 * P2P 直连时生效；TURN 中继仍有额外 RTT，无法完全消除。
 */
(function (global) {
  /** 接收端抖动缓冲目标（毫秒）；过小易卡顿，0 仅建议在局域网试 */
  const JITTER_BUFFER_TARGET_MS = 20;

  const OFFER_OPTIONS = { voiceActivityDetection: false };

  function tuneOpusSdp(sdp) {
    if (!sdp || typeof sdp !== 'string') return sdp;
    return sdp.replace(/a=fmtp:(\d+) ([^\r\n]+)/g, (line, pt, params) => {
      if (!sdp.includes(`a=rtpmap:${pt} opus/`)) return line;
      const kept = params.split(';').filter((p) => {
        const key = p.split('=')[0].toLowerCase();
        return !['minptime', 'ptime', 'maxplaybackrate'].includes(key);
      });
      kept.push(
        'minptime=10',
        'useinbandfec=1',
        'maxplaybackrate=48000'
      );
      if (!kept.some((p) => /^stereo=/i.test(p))) {
        kept.push('stereo=1');
      }
      return `a=fmtp:${pt} ${kept.join(';')}`;
    });
  }

  function tuneSessionDescription(desc) {
    if (!desc) return desc;
    const sdp = tuneOpusSdp(desc.sdp || '');
    if (typeof RTCSessionDescription !== 'undefined' && desc instanceof RTCSessionDescription) {
      return new RTCSessionDescription({ type: desc.type, sdp });
    }
    if (desc.type) return { type: desc.type, sdp };
    return { ...desc, sdp };
  }

  async function createOffer(pc, options) {
    const offer = await pc.createOffer({ ...OFFER_OPTIONS, ...(options || {}) });
    offer.sdp = tuneOpusSdp(offer.sdp);
    await pc.setLocalDescription(offer);
    return offer;
  }

  async function createAnswer(pc, options) {
    const answer = await pc.createAnswer(options || {});
    answer.sdp = tuneOpusSdp(answer.sdp);
    await pc.setLocalDescription(answer);
    return answer;
  }

  function applyPlayout(pc, jitterMs) {
    if (!pc || typeof pc.getReceivers !== 'function') return;
    const target = jitterMs != null ? jitterMs : JITTER_BUFFER_TARGET_MS;
    pc.getReceivers().forEach((recv) => {
      if (recv.track && recv.track.kind === 'audio' && 'jitterBufferTarget' in recv) {
        try { recv.jitterBufferTarget = target; } catch (_) {}
      }
    });
  }

  global.WebRTCLowLatency = {
    JITTER_BUFFER_TARGET_MS,
    OFFER_OPTIONS,
    tuneOpusSdp,
    tuneSessionDescription,
    createOffer,
    createAnswer,
    applyPlayout,
  };
})(typeof window !== 'undefined' ? window : globalThis);
