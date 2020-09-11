import React, { Component } from 'react';
import './App.css';

import MidiPlayer from "midi-player-js";
import Soundfont from "soundfont-player";
import MultiViewer from "./react-iiif-viewer/src/components/MultiViewer";
import OpenSeadragon from 'openseadragon';
import { Piano, KeyboardShortcuts } from 'react-piano';
import 'react-piano/dist/styles.css';
import fz_p1 from './images/feuerzauber_p1.gif';
import IntervalTree from 'node-interval-tree';

const ADSR_SAMPLE_DEFAULTS = { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.3 };
const UPDATE_INTERVAL_MS = 100;
const SHARP_NOTES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
const FLAT_NOTES = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab"];
const SOFT_PEDAL_RATIO = .67;
const DEFAULT_NOTE_VELOCITY = 33.0;
const HALF_BOUNDARY = 66; // F# above Middle C; divides the keyboard into two "pans"
const imageUrl = "https://stacks.stanford.edu/image/iiif/dj406yq6980%252Fdj406yq6980_0001/info.json";

class App extends Component {
  constructor(props) {
    super(props);

    this.state = {
      activeNotes: [], // For the piano vis; these should be MIDI numbers
      currentSong: null, // Song data in base64 format
      samplePlayer: null,
      playState: "stopped",
      instrument: null,
      gainNode: null,
      adsr: ADSR_SAMPLE_DEFAULTS,
      totalTicks: 0,
      sampleInst: 'acoustic_grand_piano',
      lastNotes: {}, // To handle velocity=0 "note off" events
      volumeRatio: 1.0,
      leftVolumeRatio: 1.0,
      rightVolumeRatio: 1.0,
      baseTempo: null,
      tempoRatio: 1.0, // To keep track of gradual roll acceleration
      sliderTempo: 60.0,
      playbackTempo: 0.0, // Combines slider and tempo ratio
      ac: null,
      currentTick: 0,
      currentProgress: 0.0,
      osdRef: null,
      firstHolePx: 0, // This + ticks = current pixel position
      scrollTimer: null,
      sustainPedalOn: false,
      softPedalOn: false,
      sustainPedalLocked: false,
      softPedalLocked: false,
      sustainedNotes: {},
      homeZoom: null,
      rollMetadata: {},
      panBoundary: HALF_BOUNDARY,
      pedalMap: null // Interval tree of "pedal on" tick ranges
    }

    this.midiEvent = this.midiEvent.bind(this);
    this.changeInstrument = this.changeInstrument.bind(this);
    this.playPauseSong = this.playPauseSong.bind(this);
    this.stopSong = this.stopSong.bind(this);
    this.initPlayer = this.initPlayer.bind(this);
    this.updateTempoSlider = this.updateTempoSlider.bind(this);
    this.updateVolumeSlider = this.updateVolumeSlider.bind(this);
    this.updateADSR = this.updateADSR.bind(this);
    this.skipToProgress = this.skipToProgress.bind(this);
    this.skipToPixel = this.skipToPixel.bind(this);
    this.skipToTick = this.skipToTick.bind(this);
    this.skipTo = this.skipTo.bind(this);
    this.getOSDref = this.getOSDref.bind(this);
    this.panViewportToTick = this.panViewportToTick.bind(this);
    this.midiNotePlayer = this.midiNotePlayer.bind(this);
    this.getNoteName = this.getNoteName.bind(this);
    this.togglePedalLock = this.togglePedalLock.bind(this);
    this.changeSustainPedal = this.changeSustainPedal.bind(this);
  }

  componentDidMount() {

    /* Load MIDI data as JSON {"songname": "base64midi"} */
    let mididata = require("./mididata.json");

    let AudioContext = window.AudioContext || window.webkitAudioContext || false; 
    let ac = new AudioContext();
    
    /* Necessary for volume control */
    const gainNode = ac.createGain();
    gainNode.connect(ac.destination);
    this.setState({gainNode});

    let currentSong = mididata['magic_fire'];

    this.setState({ac, currentSong});

    // Instantiate the sample-based player
    // Custom soundfouts can be loaded via a URL. They should be in
    // MIDI.js format. 
    Soundfont.instrument(ac, this.state.sampleInst, { soundfont: 'MusyngKite' }).then(this.initPlayer);
    //Soundfont.instrument(ac, "http://localhost/~pmb/demotron/salamander_acoustic_grand-mod-ogg.js" ).then(this.initPlayer);
  }

  getOSDref(osdRef) {

    this.setState({osdRef});
    osdRef.current.openSeadragon.viewport.viewer.addHandler("canvas-drag", (e) => {
      let center = osdRef.current.openSeadragon.viewport.getCenter();
      let centerCoords = osdRef.current.openSeadragon.viewport.viewportToImageCoordinates(center);
      this.skipToPixel(centerCoords.y);
    });
  }

  playPauseSong() {

    if (this.state.samplePlayer.isPlaying()) {
      this.state.samplePlayer.pause();
      clearInterval(this.state.scrollTimer);
      this.setState({ playState: "paused", scrollTimer: null });
    } else {
      this.state.osdRef.current.openSeadragon.viewport.zoomTo(this.state.homeZoom);
      let scrollTimer = setInterval(this.panViewportToTick, UPDATE_INTERVAL_MS);
      this.setState({ scrollTimer, playState: "playing" });
      this.state.samplePlayer.play();
    }
  }

  stopSong() {
    if (this.state.samplePlayer.isPlaying() || (this.state.playState === "paused")) {

      this.state.samplePlayer.stop();
      clearInterval(this.state.scrollTimer);
      this.setState({ playState: "stopped", scrollTimer: null, lastNotes: {}, activeNotes: [], sustainedNotes: {} });
      this.panViewportToTick(0);
    }
  }

  skipToPixel(yPixel) {
    const targetTick = yPixel - this.state.firstHolePx;
    const targetProgress = parseFloat(targetTick) / parseFloat(this.state.totalTicks);

    this.skipTo(targetTick, targetProgress)
  }

  skipToProgress(event) {
    const targetProgress = event.target.value;
    const targetTick = parseInt(targetProgress * parseFloat(this.state.totalTicks));

    this.skipTo(targetTick, targetProgress);
  }

  skipToTick(targetTick) {
    const targetProgress = parseFloat(targetTick) / parseFloat(this.state.totalTicks);

    this.skipTo(targetTick, targetProgress);
  }

  skipTo(targetTick, targetProgress) {
    if (!this.state.samplePlayer) {
      return;
    }
    // XXX The notes will sort themselves out, but the wrong pedals will
    // possibly be on/off and stay that after skipping around a roll. The best
    // (probably only) way to fix this is to look backwards in the event
    // sequence, or ideally build a complete timeline of pedal actions
    // before playback.

    let playTick = Math.max(0, targetTick);
    let playProgress = Math.max(0, targetProgress);

    const pedalsOn = this.state.pedalMap.search(playTick, playTick);

    let sustainPedalOn = this.state.sustainPedalLocked || pedalsOn.includes("sustain");
    let softPedalOn = this.state.softPedalLocked || pedalsOn.includes("soft");

    if (this.state.samplePlayer.isPlaying()) {
      this.state.samplePlayer.pause();
      this.state.samplePlayer.skipToTick(playTick);
      this.setState({ lastNotes: {}, activeNotes: [], sustainedNotes: {}, currentProgress: playProgress });
      this.state.samplePlayer.play();
    } else {
      this.state.samplePlayer.skipToTick(playTick);
      this.panViewportToTick(targetTick);
    }
    this.setState({ sustainPedalOn, softPedalOn });
  }

  updateTempoSlider(event) {

    const playbackTempo = event.target.value * this.state.tempoRatio;

    // If not paused during tempo change, player jumps back a bit on
    // shift to slower playback tempo, forward on shift to faster tempo.
    this.state.samplePlayer.pause();
    this.state.samplePlayer.setTempo(playbackTempo);
    this.state.samplePlayer.play();
    this.setState({sliderTempo: event.target.value, playbackTempo});
  }

  updateVolumeSlider(event) {

    let sliderName = event.target.name;

    if (sliderName === "volume") {
      this.setState({volumeRatio: event.target.value});
    } else if (sliderName === "left") {
      this.setState({leftVolumeRatio: event.target.value});
    } else if (sliderName === "right") {
      this.setState({rightVolumeRatio: event.target.value});
    }
  }

  updateADSR(event) {
    let adsr = {...this.state.adsr};
    adsr[event.target.id] = event.target.value;
    this.setState({adsr});
  }

  /* SAMPLE-BASED PLAYBACK USING midi-player-js AND soundfont-player */

  initPlayer(inst) {

    /* Instantiate the MIDI player */
    let MidiSamplePlayer = new MidiPlayer.Player();

    /* Various event handlers, mostly used for debugging */

    // This is how to know when a note sample has finished playing
    inst.on('ended', (when, name) => {
      //console.log('ended', name)
    });

    MidiSamplePlayer.on('fileLoaded', () => {
      console.log("data loaded");
    });
    
    MidiSamplePlayer.on('playing', currentTick => {
        //console.log(currentTick);
        // Do something while player is playing
        // (this is repeatedly triggered within the play loop)
    });
    
    MidiSamplePlayer.on('midiEvent', this.midiEvent);
    
    MidiSamplePlayer.on('endOfFile', function() {
        console.log("END OF FILE");
        this.stopSong();
        // Do something when end of the file has been reached.
    }.bind(this));

    /* Load MIDI data */
    MidiSamplePlayer.loadDataUri(this.state.currentSong);

    this.state.osdRef.current.openSeadragon.viewport.fitHorizontally(true);

    let viewportBounds = this.state.osdRef.current.openSeadragon.viewport.getBounds();
 
    // This will do a "dry run" of the playback and set all event timings.
    // Should already done by this point... (?)
    //MidiSamplePlayer.fileLoaded();

    let pedalMap = new IntervalTree();

    // Pedal events should be duplicated on each track, but best not to assume
    // this will always be the case. Assume however that the events are
    // always temporally ordered in each track.
    let trackNumber = 0;
    MidiSamplePlayer.events.forEach((track) => {
      let sustainOn = false;
      let softOn = false;
      let sustainStart = 0;
      let softStart = 0;
      trackNumber += 1;
      track.forEach((event) => {
        if (event.name === "Controller Change") {
          // Sustain pedal on/off
          if (event.number == 64) {
            if ((event.value == 127) && (sustainOn != true)) {
              sustainOn = true;
              sustainStart = event.tick;
            } else if (event.value == 0) {
              sustainOn = false;
              pedalMap.insert(sustainStart, event.tick, "sustain");
            }
          // Soft pedal on/off
          } else if (event.number == 67) {
            // Consecutive "on" events just mean "yep, still on" ??
            if ((event.value == 127) && (softOn != true)) {
              softOn = true;
              softStart = event.tick;
            } else if (event.value == 0) {
              softOn = false;
              pedalMap.insert(softStart, event.tick, "soft");
            }
          }
        }
      });
    });

    let firstHolePx = 0;
    let lastHolePx = 0;
    let holeWidthPx = 0;
    let baseTempo = null;
    let earliestTempoTick = null;
    let rollMetadata = {};
    const metadataRegex = /^@(?<key>[^:]*):[\t\s]*(?<value>.*)$/;

    MidiSamplePlayer.events[0].forEach((event) => {
      /* Tempo events *should* be in order, and the tempo *should* only ever
       * increase... but we'll play it safe. */
      if (event.name === "Set Tempo") {
        if ((earliestTempoTick === null) || (event.tick < earliestTempoTick)) {
          baseTempo = event.data;
          earliestTempoTick = event.tick;
        }
      } else if (event.name === "Text Event") {
        let text = event.string;
        if (!text) return;
        /* @IMAGE_WIDTH and @IMAGE_LENGTH should be the same as from viewport._contentSize
        * Can't think of why they wouldn't be, but maybe check anyway. Would need to scale
        * all pixel values if so.
        * Other potentially useful values, e.g., for drawing overlays:
        * @ROLL_WIDTH (this is smaller than the image width)
        * @HARD_MARGIN_TREBLE
        * @HARD_MARGIN_BASS
        * @HOLE_SEPARATION
        * @HOLE_OFFSET
        * All of the source/performance/recording metadata is in this track as well.
        */
        const found = text.match(metadataRegex);
        rollMetadata[found.groups.key] = found.groups.value;
      }
    });

    firstHolePx = parseInt(rollMetadata['FIRST_HOLE']);
    lastHolePx = parseInt(rollMetadata['LAST_HOLE']);
    holeWidthPx = parseInt(rollMetadata['AVG_HOLE_WIDTH']);

    let firstLineViewport = this.state.osdRef.current.openSeadragon.viewport.imageToViewportCoordinates(0,firstHolePx);

    let bounds = new OpenSeadragon.Rect(0.0,firstLineViewport.y - (viewportBounds.height / 2.0),viewportBounds.width, viewportBounds.height);
    this.state.osdRef.current.openSeadragon.viewport.fitBounds(bounds, true);

    let homeZoom = this.state.osdRef.current.openSeadragon.viewport.getZoom();

    /*
    // Play line can be drawn via CSS (though not as accurately), but very
    // similar code to this would be used to show other overlays, e.g., to
    // "fill" in actively playing notes and other mechanics. Performance is
    // an issue, though.
    let startBounds = this.state.osdRef.current.openSeadragon.viewport.getBounds();
    let playPoint = new OpenSeadragon.Point(0, startBounds.y + (startBounds.height / 2.0));
    let playLine = this.state.osdRef.current.openSeadragon.viewport.viewer.getOverlayById('play-line');
    if (!playLine) {
      playLine = document.createElement("div");
      playLine.id = "play-line";
      this.state.osdRef.current.openSeadragon.viewport.viewer.addOverlay(playLine, playPoint, OpenSeadragon.Placement.TOP_LEFT);
    } else {
      playLine.update(playPoint, OpenSeadragon.Placement.TOP_LEFT);
    }
    */
    this.setState({ samplePlayer: MidiSamplePlayer, instrument: inst, totalTicks: MidiSamplePlayer.totalTicks, firstHolePx, baseTempo, homeZoom, rollMetadata, pedalMap });
  }

  midiEvent(event) {
    // Do something when a MIDI event is fired.
    // (this is the same as passing a function to MidiPlayer.Player() when instantiating).
    if (event.name === 'Note on') {

      const noteNumber = event.noteNumber;
      const noteName = this.getNoteName(noteNumber);
      let noteVelocity = event.velocity;
      let lastNotes = {...this.state.lastNotes};
      let activeNotes = [...this.state.activeNotes];
      let sustainedNotes = {...this.state.sustainedNotes};

      if (noteVelocity === 0) {
        if ((noteName in this.state.lastNotes) && (!(noteName in this.state.sustainedNotes))) {
          try {
            this.state.lastNotes[noteName].stop();
          } catch {
            console.log("COULDN'T STOP NOTE, PROBABLY DUE TO WEIRD ADSR VALUES, RESETTING");
            this.setState({ adsr: ADSR_SAMPLE_DEFAULTS });
          }
          delete lastNotes[noteName];
        }
        while(activeNotes.includes(noteNumber)) {
          activeNotes.splice(activeNotes.indexOf(noteNumber), 1);
        }
        this.setState({ lastNotes, activeNotes });
      } else {
        let updatedVolume = noteVelocity/100.0 * this.state.volumeRatio;
        if (this.state.softPedalOn) {
          updatedVolume *= SOFT_PEDAL_RATIO;
        }
        if (noteNumber < this.state.panBoundary) {
          updatedVolume *= this.state.leftVolumeRatio;
        } else if (noteNumber >= this.state.panBoundary) {
          updatedVolume *= this.state.rightVolumeRatio;
        }

        try {
          let adsr = [this.state.adsr['attack'], this.state.adsr['decay'], this.state.adsr['sustain'], this.state.adsr['release']];
          let noteNode = this.state.instrument.play(noteName, this.state.ac.currentTime, { gain: updatedVolume, adsr });
          if (this.state.sustainPedalOn) {
            sustainedNotes[noteName] = noteNode;
          }
          lastNotes[noteName] = noteNode;
        } catch {
          // Get rid of this eventually
          console.log("IMPOSSIBLE ADSR VALUES FOR THIS NOTE, RESETTING");
          let adsr = [ADSR_SAMPLE_DEFAULTS['attack'], ADSR_SAMPLE_DEFAULTS['decay'], ADSR_SAMPLE_DEFAULTS['sustain'], ADSR_SAMPLE_DEFAULTS['release']];
          let noteNode = this.state.instrument.play(noteName, this.state.ac.currentTime, { gain: updatedVolume, adsr });
          lastNotes[noteName] = noteNode;
          this.setState({adsr: ADSR_SAMPLE_DEFAULTS});
        }
        activeNotes.push(noteNumber);
        this.setState({lastNotes, activeNotes, sustainedNotes});
      }
    } else if (event.name === "Controller Change") {
      // Controller Change number=64 is a sustain pedal event;
      // 127 is down (on), 0 is up (off)
      if ((event.number == 64) && !this.state.sustainPedalLocked) {
        if (event.value == 127) {
          this.changeSustainPedal(true);
        } else if (event.value == 0) {
          this.changeSustainPedal(false);
        }
      // 67 is the soft (una corda) pedal
      } else if (event.number == 67 && !this.state.softPedalLocked) {
        if (event.value == 127) {
          this.setState({ softPedalOn: true });
        } else if (event.value == 0) {
          this.setState({ softPedalOn: false });
        }
      } else if (event.number == 10) {
        // Controller Change number=10 sets the "panning position",
        // which is supposed to divide the keyboard into portions,
        // presumably bass and treble. These values are a bit odd
        // however and it's not clear how to use them, e.g.,
        // track 2: value = 52, track 3: value = 76
        //this.setState({ panBoundary: event.value });
      }
    } else if (event.name === "Set Tempo") {
      const tempoRatio = 1 + (parseFloat(event.data) - parseFloat(this.state.baseTempo)) / parseFloat(this.state.baseTempo);
      const playbackTempo = parseFloat(this.state.sliderTempo) * tempoRatio;
      
      this.state.samplePlayer.setTempo(playbackTempo);
      this.setState({tempoRatio, playbackTempo});
    }

    // The scrollTimer should ensure that the roll is synchronized with
    // playback; syncing at every note effect also can cause problems
    // on certain browsers if the playback events start to lag behind
    // their scheduled times.
    //this.panViewportToTick(event.tick);

  }

  changeSustainPedal(trueIfOn) {
    if (trueIfOn) {
      let sustainedNotes = {};
      this.state.activeNotes.forEach((noteNumber) => {
        const noteName = this.getNoteName(noteNumber);
        sustainedNotes[noteName] = this.state.lastNotes[noteName];
      });
      this.setState({ sustainPedalOn: true, sustainedNotes });
    } else {
      let lastNotes = {...this.state.lastNotes};
      Object.keys(this.state.sustainedNotes).forEach((noteName) => {
        if (typeof(this.state.sustainedNotes[noteName]) === 'undefined') {
          return;
        }
        let noteNumber = this.getMidiNumber(noteName);
        if (!(this.state.activeNotes.includes(noteNumber))) {
          // XXX Maybe use a slower release velocity for pedal events?
          if (typeof(this.state.sustainedNotes[noteName].stop === 'function')) {
            try {
              this.state.sustainedNotes[noteName].stop();
            } catch {
              // XXX This can happen with manual keyboard note entry
              console.log("TRIED TO UNSUSTAIN AN ALREADY STOPPED NOTE");
            }
          }
          delete lastNotes[noteName];
        }
      });
      this.setState({ sustainPedalOn: false, sustainedNotes: {}, lastNotes });
    }
  }

  panViewportToTick(tick) {
    /* PAN VIEWPORT IMAGE */

    // If this is fired from the scrollTimer event (quite likely) the tick
    // argument will be undefined, so we get it from the player itself.
    if ((typeof(tick) === 'undefined') || isNaN(tick) || (tick === null)) {
      tick = this.state.samplePlayer.getCurrentTick();
    }

    let viewportBounds = this.state.osdRef.current.openSeadragon.viewport.getBounds();

    // Thanks to Craig, MIDI tick numbers correspond to pixels from the first
    // hole of the roll.
    let linePx = this.state.firstHolePx + tick;

    let lineViewport = this.state.osdRef.current.openSeadragon.viewport.imageToViewportCoordinates(0,linePx);

    let lineCenter = new OpenSeadragon.Point(viewportBounds.width / 2.0, lineViewport.y);
    this.state.osdRef.current.openSeadragon.viewport.panTo(lineCenter);


    let targetProgress = parseFloat(tick) / this.state.totalTicks;
    let playProgress = Math.max(0, targetProgress);
    let playTick = Math.max(0, tick);

    this.setState({currentTick: playTick, currentProgress: playProgress});

  }

  changeInstrument(e) {
    const newInstName = e.target.value;

    // XXX This mostly works, except that when switching back to the
    // acoustic_grand_piano, the bright_acoustic_piano plays instead.
    // Possibly this problem is rooted in how the soundfonts are
    // defined, i.e., if the bright_acoustic is just a modification of
    // the samples in acoustic_grand, the system may erroneously
    // assume they're the same...
    Soundfont.instrument(this.state.ac, newInstName, { soundfont: 'FluidR3_GM' }).then(
      (instrument) => this.setState({ instrument, sampleInst: newInstName }));
  }

  // This is for playing notes manually pressed (clicked) on the keyboard
  midiNotePlayer(noteNumber, trueIfOn, prevActiveNotes) {

    let lastNotes = {...this.state.lastNotes};
    const noteName = this.getNoteName(noteNumber);

    if (trueIfOn) {
      let updatedVolume = DEFAULT_NOTE_VELOCITY/100.0 * this.state.volumeRatio;
      if (this.state.softPedalOn) {
        updatedVolume *= SOFT_PEDAL_RATIO;
      }
      if (noteNumber < HALF_BOUNDARY) {
        updatedVolume *= this.state.leftVolumeRatio;
      } else if (noteNumber >= HALF_BOUNDARY) {
        updatedVolume *= this.state.rightVolumeRatio;
      }
      let noteNode = this.state.instrument.play(noteName, this.state.ac.currentTime, {gain: updatedVolume, adsr: this.state.adsr });
      lastNotes[noteName] = noteNode;
    } else {
      // XXX This does not work as currently configured -- stop() call always
      // fails, and the note just eventually times/decays out rather than
      // responding properly to the "on stop" event.
      let noteNode = lastNotes[noteName];
      if (typeof(noteNode) === 'undefined') {
        return;
      }
      try {
        noteNode.stop();
      } catch(error) {
      }
      delete lastNotes[noteName];
    }
    this.setState({ lastNotes });
  }

  getNoteName(midiNumber) {
    const octave = parseInt(midiNumber / 12) - 1;
    midiNumber -= 21;
    const name = SHARP_NOTES[midiNumber % 12];
    return name + octave;
  }

  getMidiNumber(noteName) {
    let note = "";
    let octave = 0;
    for (let i = 0; i < noteName.length; i++) {
      let c = noteName.charAt(i);
      if (c >= '0' && c <= '9') {
        octave = parseInt(c);
      } else {
        note += c;
      }
    }
    let midiNumber = NaN;
    if (SHARP_NOTES.includes(note)) {
      midiNumber = ((octave - 1) * 12) + SHARP_NOTES.indexOf(note) + 21; 
    } else if (FLAT_NOTES.includes(note)) {
      midiNumber = ((octave -1) * 12) + FLAT_NOTES.indexOf(note) + 21; 
    }
    return midiNumber;    
  }

  togglePedalLock(event) {
    const pedalName = event.target.name;
    if (pedalName === "sustain") {
      if (this.state.sustainPedalLocked) {
        // Release sustained notes
        this.setState({sustainPedalLocked: false });
        this.changeSustainPedal(false);
      } else {
        this.setState({sustainPedalLocked: true });
        this.changeSustainPedal(true);
      }
    } else if (pedalName === "soft") {
      let softPedalLocked = !this.state.softPedalLocked;
      this.setState({ softPedalLocked, softPedalOn: softPedalLocked });  
    }
  }

  render() {

    return (
      <div className="App">
        <div className="flex-container" style={{display: "flex", flexDirection: "row", justifyContent: "space-around", width: "1000px" }}>
          <div>
            <div style={{textAlign: "left"}}>
              <strong>Title:</strong> {this.state.rollMetadata['TITLE']}<br />
              <strong>Performer:</strong> {this.state.rollMetadata['PERFORMER']}<br />
              <strong>Composer:</strong> {this.state.rollMetadata['COMPOSER']}<br />
            </div>
            <hr />
            <button id="pause" onClick={this.playPauseSong} style={{background: (this.state.playState === "paused" ? "lightgray" : "white")}}>Play/Pause</button>
            <button id="stop" onClick={this.stopSong} style={{background: "white"}}>Stop</button>
            <div style={{textAlign: "left"}}>
              <div>Tempo: <input type="range" min="0" max="180" value={this.state.sliderTempo} className="slider" id="tempoSlider" onChange={this.updateTempoSlider} /> {this.state.sliderTempo} bpm</div>
              <div>Master Volume: <input type="range" min="0" max="4" step=".1" value={this.state.volumeRatio} className="slider" id="masterVolumeSlider" name="volume" onChange={this.updateVolumeSlider} /> {this.state.volumeRatio}</div>
              <div>Bass Volume: <input type="range" min="0" max="4" step=".1" value={this.state.leftVolumeRatio} className="slider" id="leftVolumeSlider" name="left" onChange={this.updateVolumeSlider} /> {this.state.leftVolumeRatio}</div>
              <div>Treble Volume: <input type="range" min="0" max="4" step=".1" value={this.state.rightVolumeRatio} className="slider" id="rightVolumeSlider" name="right" onChange={this.updateVolumeSlider} /> {this.state.rightVolumeRatio}</div>
              <div>Progress: <input type="range" min="0" max="1" step=".01" value={this.state.currentProgress} className="slider" id="progress" onChange={this.skipToProgress} /> {(this.state.currentProgress * 100.).toFixed(2)+"%"} </div>
            </div>
          </div>
          <div>
            <div style={{textAlign: "left"}}>
              <strong>Label:</strong> {this.state.rollMetadata['LABEL']}<br />
              <strong>PURL:</strong> <a href={this.state.rollMetadata['PURL']}>{this.state.rollMetadata['PURL']}</a><br />
              <strong>Call No:</strong> {this.state.rollMetadata['CALLNUM']}<br />
            </div>
            <hr />
            <div>
              <label htmlFor="sampleInstrument">
                Sample instrument:{" "}
              </label>
              <select
                value={this.state.sampleInst}
                type="string"
                name="sampleInstrument"
                id="sampleInstrument"
                onChange={this.changeInstrument}
              >
                <option value="acoustic_grand_piano">Acoustic Grand</option>
                <option value="bright_acoustic_piano">Bright Acoustic</option>
                <option value="electric_piano_1">Electric 1</option>
                <option value="electric_piano_2">Electric 2</option>
              </select>
            </div>
            <div style={{textAlign: "left"}}>ADSR envelope (experimental):
              <div>Attack: <input disabled type="range" min="0" max=".02" step=".01" value={this.state.adsr['attack']} className="slider" id="attack" onChange={this.updateADSR}/> {this.state.adsr['attack']}</div>
              <div>Decay: <input disabled type="range" min="0" max=".1" step=".01" value={this.state.adsr['decay']} className="slider" id="decay" onChange={this.updateADSR}/> {this.state.adsr['decay']}</div>
              <div>Sustain: <input type="range" min="0" max="5" step=".1" value={this.state.adsr['sustain']} className="slider" id="sustain" onChange={this.updateADSR}/> {this.state.adsr['sustain']}</div>
              <div>Release: <input disabled type="range" min="0" max="1" step=".1" value={this.state.adsr['release']} className="slider" id="release" onChange={this.updateADSR}/> {this.state.adsr['release']}</div>          
            </div>
          </div>
        </div>  
        <Piano
          noteRange={{ first: 21, last: 108 }}
          playNote={(midiNumber) => {
            //this.midiNotePlayer(midiNumber, true, false, []);
          }}
          stopNote={(midiNumber) => {
            //this.midiNotePlayer(midiNumber, false, false, []);
          }}
          width={1000}
          onPlayNoteInput={(midiNumber, { prevActiveNotes }) => {
            this.midiNotePlayer(midiNumber, true, prevActiveNotes);
          }}
          onStopNoteInput={(midiNumber, { prevActiveNotes }) => {
            this.midiNotePlayer(midiNumber, false, prevActiveNotes);
          }}
          // keyboardShortcuts={keyboardShortcuts}
          activeNotes={this.state.activeNotes}
        />
        <div style={{width: "1000px"}}>
          <button id="soft_pedal" name="soft" onClick={this.togglePedalLock} style={{background: (this.state.softPedalOn ? "lightblue" : "white")}}>SOFT</button>
          <button id="sustain_pedal" name="sustain" onClick={this.togglePedalLock} style={{background: (this.state.sustainPedalOn ? "lightblue" : "white")}}>SUST</button>
        </div>
        <div className="flex-container" style={{display: "flex", flexDirection: "row", justifyContent: "space-between", width: "1000px" }}>
          <div>
            <MultiViewer
              height="800px"
              width="500px"
              iiifUrls={[imageUrl]}
              showToolbar={false}
              backdoor={this.getOSDref}
            />
          </div>
          <div>
            <img style={{"width": "500px"}} src={fz_p1}/>
          </div>
        </div>
      </div>
    );
  }
}

export default App;
