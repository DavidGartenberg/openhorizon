// Neural voices for the radio: a long-running helper the speech server talks to over stdin/stdout.
//
// macOS has voices that `say` cannot use: the Siri natural voices and the Premium neural voices, far
// more human than the built-in ones. They are only visible to Apple-signed processes, so this script
// is run with /usr/bin/swift (an unsigned compiled binary sees none of them), and kept running because
// the interpreter takes several seconds to start.
//
// Requests are one JSON object per line on stdin, replies one JSON object per line on stdout:
//   {"op":"list"}                                   -> {"ok":true,"voices":[{id,name,language,quality}, ...]}
//   {"op":"speak","id":"1","voice":"<identifier>","rate":0.52,"pitch":1.0,"text":"...","out":"/path.wav"}
//                                                   -> {"ok":true,"id":"1","seconds":4.2}
// The file written is mono 16 kHz 16-bit PCM WAV, what the speech server and the radio filter expect.
// It prints {"ready":true} once it is listening.
import AVFoundation
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ object: [String: Any]) {
  if let data = try? JSONSerialization.data(withJSONObject: object), let text = String(data: data, encoding: .utf8) { print(text) }
}

let targetRate = 16_000.0
let targetFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: targetRate, channels: 1, interleaved: false)!
let fileSettings: [String: Any] = [
  AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: targetRate, AVNumberOfChannelsKey: 1,
  AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false, AVLinearPCMIsNonInterleaved: false,
]

func listVoices() -> [[String: Any]] {
  AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("en") }.map {
    ["id": $0.identifier, "name": $0.name, "language": $0.language, "quality": $0.quality.rawValue]
  }
}

/// The synthesizer of the job in progress: it must stay alive until its last buffer has arrived.
var current: AVSpeechSynthesizer?

func speak(_ request: [String: Any], done: @escaping ([String: Any]) -> Void) {
  guard let text = request["text"] as? String, !text.isEmpty, let out = request["out"] as? String else {
    return done(["ok": false, "error": "text and out are required"])
  }
  let utterance = AVSpeechUtterance(string: text)
  if let id = request["voice"] as? String {
    guard let voice = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.identifier == id }) else {
      return done(["ok": false, "error": "no such voice"])
    }
    utterance.voice = voice
  }
  if let rate = request["rate"] as? Double { utterance.rate = Float(min(max(rate, 0.0), 1.0)) }
  if let pitch = request["pitch"] as? Double { utterance.pitchMultiplier = Float(min(max(pitch, 0.5), 2.0)) }
  utterance.preUtteranceDelay = 0
  utterance.postUtteranceDelay = 0

  let synth = AVSpeechSynthesizer()
  current = synth
  var file: AVAudioFile?
  var converter: AVAudioConverter?
  var frames = 0
  var finished = false
  func finish(_ result: [String: Any]) {
    if finished { return }
    finished = true
    file = nil          // closes the file: the WAV header is written now
    current = nil
    done(result)
  }

  synth.write(utterance) { buffer in
    guard let pcm = buffer as? AVAudioPCMBuffer else { return }
    if pcm.frameLength == 0 {
      DispatchQueue.main.async { finish(frames > 0 ? ["ok": true, "seconds": Double(frames) / targetRate] : ["ok": false, "error": "no audio"]) }
      return
    }
    do {
      if file == nil {
        file = try AVAudioFile(forWriting: URL(fileURLWithPath: out), settings: fileSettings, commonFormat: .pcmFormatFloat32, interleaved: false)
        converter = AVAudioConverter(from: pcm.format, to: targetFormat)
      }
      guard let converter = converter else { throw NSError(domain: "voice", code: 1, userInfo: [NSLocalizedDescriptionKey: "no converter"]) }
      let capacity = AVAudioFrameCount(Double(pcm.frameLength) * targetRate / pcm.format.sampleRate) + 256
      guard let converted = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: capacity) else { return }
      var supplied = false
      var conversionError: NSError?
      converter.convert(to: converted, error: &conversionError) { _, status in
        if supplied { status.pointee = .noDataNow; return nil }
        supplied = true
        status.pointee = .haveData
        return pcm
      }
      if let conversionError = conversionError { throw conversionError }
      try file?.write(from: converted)
      frames += Int(converted.frameLength)
    } catch {
      DispatchQueue.main.async { finish(["ok": false, "error": "\(error)"]) }
    }
  }
  DispatchQueue.main.asyncAfter(deadline: .now() + 40) { finish(["ok": false, "error": "timeout"]) }
}

DispatchQueue.global().async {
  while let line = readLine() {
    guard let data = line.data(using: .utf8), let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      emit(["ok": false, "error": "bad request"])
      continue
    }
    let semaphore = DispatchSemaphore(value: 0)
    DispatchQueue.main.async {
      let id = request["id"] as? String
      let reply: ([String: Any]) -> Void = { result in
        var out = result
        if let id = id { out["id"] = id }
        emit(out)
        semaphore.signal()
      }
      switch request["op"] as? String {
      case "list": reply(["ok": true, "voices": listVoices()])
      case "speak": speak(request, done: reply)
      default: reply(["ok": false, "error": "unknown op"])
      }
    }
    semaphore.wait()
  }
  exit(0)
}

emit(["ready": true])
RunLoop.main.run()
