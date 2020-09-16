import React, { Component } from 'react';
import './App.css';

import MidiPlayer from "midi-player-js";
import Soundfont from "soundfont-player";
import MultiViewer from "./react-iiif-viewer/src/components/MultiViewer";
import OpenSeadragon from 'openseadragon';
import { Piano, KeyboardShortcuts } from 'react-piano';
import 'react-piano/dist/styles.css';
// import fz_p1 from './images/feuerzauber_p1.gif';
import IntervalTree from 'node-interval-tree';
import verovio from 'verovio';
import parse from 'html-react-parser';

const ADSR_SAMPLE_DEFAULTS = { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.3 };
const UPDATE_INTERVAL_MS = 100;
const SHARP_NOTES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
const FLAT_NOTES = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab"];
const SOFT_PEDAL_RATIO = .67;
const DEFAULT_NOTE_VELOCITY = 33.0;
const HALF_BOUNDARY = 66; // F# above Middle C; divides the keyboard into two "pans"
//const IMAGE_URL = "https://stacks.stanford.edu/image/iiif/dj406yq6980%252Fdj406yq6980_0001/info.json";
const IMAGE_URL = "https://stacks.stanford.edu/image/iiif/zb497jz4405%2Fzb497jz4405_0001/info.json";

class App extends Component {
  constructor(props) {
    super(props);

    this.state = {
      activeNotes: [], // Notes currently being pressed, must be MIDI numbers (integers)
      currentSong: null, // Song data in base64 format
      samplePlayer: null, // The MidiPlayer object (sample = soundfont, not synth)
      scorePlayer: null,
      playState: "stopped",
      instrument: null, // The Soundfont player "instrument"
      gainNode: null, // For modifying output volume
      adsr: ADSR_SAMPLE_DEFAULTS,
      totalTicks: 0,
      sampleInst: 'acoustic_grand_piano',
      activeAudioNodes: {}, // Maps note MIDI numbers to playback node objects
      volumeRatio: 1.0,
      leftVolumeRatio: 1.0,
      rightVolumeRatio: 1.0,
      baseTempo: null,
      tempoRatio: 1.0, // To keep track of gradual roll acceleration
      sliderTempo: 60.0,
      playbackTempo: 0.0, // Combines slider and tempo ratio
      ac: null, // The master audio context
      currentTick: 0,
      currentProgress: 0.0,
      osdRef: null, // Backdoor pointer to the OpenSeadragon component
      firstHolePx: 0, // This + ticks = current pixel position
      scrollTimer: null, // Fires every 1/x seconds to advance the scroll
      sustainPedalOn: false,
      softPedalOn: false,
      sustainPedalLocked: false,
      softPedalLocked: false,
      sustainedNotes: [], // All the note (numbers) being held by the pedal
      homeZoom: null,
      rollMetadata: {},
      panBoundary: HALF_BOUNDARY,
      scorePages: [],
      scoreMIDI: [],
      scorePlaying: false,
      currentScorePage: 1,
      highlightedNotes: [],
      timeMultiplier: 0, // length of score MIDI in ms / total MIDI ticks
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
    this.sustainPedalOn = this.sustainPedalOn.bind(this);
    this.sustainPedalOff = this.sustainPedalOff.bind(this);
    this.playScore = this.playScore.bind(this);
  }

  componentDidMount() {

    /* Load MIDI data as JSON {"songname": "base64midi"} */
    let midiData = require("./mididata.json");
    let scoreData = require("./scoredata.mei.json");

    let AudioContext = window.AudioContext || window.webkitAudioContext || false; 
    let ac = new AudioContext();
    
    /* Necessary for volume control */
    const gainNode = ac.createGain();
    gainNode.connect(ac.destination);
    this.setState({gainNode});

    //let currentSong = midiData['magic_fire'];
    let currentSong = midiData['mozart_rondo_alla_turca'];

    this.setState({ac, gainNode, currentSong});

    // Instantiate the sample-based player
    // Custom soundfouts can be loaded via a URL. They should be in
    // MIDI.js format. 
    Soundfont.instrument(ac, this.state.sampleInst, { soundfont: 'MusyngKite' }).then(this.initPlayer);
    //Soundfont.instrument(ac, "http://localhost/~pmb/demotron/salamander_acoustic_grand-mod-ogg.js" ).then(this.initPlayer);
    
    verovio.module.onRuntimeInitialized = function() {
      /* create the toolkit instance */
      let vrvToolkit = new verovio.toolkit();

      /* load the MEI data as string into the toolkit */
      vrvToolkit.loadData(scoreData['mozart_rondo_alla_turca']);

      /* render the fist page as SVG */
      let scorePages = [];
      for (let i=1; i<=vrvToolkit.getPageCount(); i++) {
        scorePages.push(parse(vrvToolkit.renderToSVG(i, {})));
      }
      let scoreMIDI = "data:audio/midi;base64," + vrvToolkit.renderToMIDI();

      /* Instantiate the score MIDI player */
      let MidiSamplePlayer = new MidiPlayer.Player();
      MidiSamplePlayer.on('fileLoaded', () => {

        // This may need to be computed slightly differently in order for the
        // note highlighting to be better aligned with the playback.
        const timeMultiplier = parseFloat(MidiSamplePlayer.getSongTime() * 1000) / parseFloat(MidiSamplePlayer.totalTicks);

        this.setState({ scorePlayer: MidiSamplePlayer, timeMultiplier });

      });

      MidiSamplePlayer.on('playing', currentTick => {
        //console.log(currentTick, this.state.totalTicks);
        // Do something while player is playing
        // (this is repeatedly triggered within the play loop)
      });

      MidiSamplePlayer.on('midiEvent', function(e) {

        let vrvTime = Math.max(0, parseInt(e.tick * this.state.timeMultiplier)+1);
        let elementsattime = vrvToolkit.getElementsAtTime(vrvTime);

        let lastNoteIds = this.state.highlightedNotes;
        if (lastNoteIds.length > 0) {
          lastNoteIds.forEach((noteId) => {
            let noteElt = document.getElementById(noteId);
            noteElt.setAttribute("style", "fill: #000");
          });
        }

        if (elementsattime.page > 0) {
          if (elementsattime.page != this.state.currentScorePage) {
            let page = elementsattime.page;
             this.setState({currentScorePage: page});
          }
        }

        let noteIds = elementsattime.notes;
        if (noteIds.length > 0) {
          noteIds.forEach((noteId) => {
            let noteElt = document.getElementById(noteId);
            noteElt.setAttribute("style", "fill: #c00");
          });
        }
        this.setState({ highlightedNotes: noteIds });
        this.midiEvent(e);
      }.bind(this));

      MidiSamplePlayer.on('endOfFile', function() {
        console.log("END OF FILE");
        this.playScore(false);
        // Do something when end of the file has been reached.
      }.bind(this));

      /* Load MIDI data */
      MidiSamplePlayer.loadDataUri(scoreMIDI);

      this.setState({scorePages, scoreMIDI});
    }.bind(this);
  
  }

  getOSDref(osdRef) {

    this.setState({osdRef});
    // On drag, advance (or rewind) the player to the center of the visible roll
    osdRef.current.openSeadragon.viewport.viewer.addHandler("canvas-drag", () => {
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
      this.setState({ scrollTimer, playState: "playing", totalTicks: this.state.samplePlayer.totalTicks });
      this.state.samplePlayer.play();
    }
  }

  stopSong() {
    if (this.state.samplePlayer.isPlaying() || (this.state.playState === "paused")) {

      this.state.samplePlayer.stop();
      clearInterval(this.state.scrollTimer);
      this.setState({ playState: "stopped", scrollTimer: null, activeAudioNodes: {}, activeNotes: [], sustainedNotes: [] });
      this.panViewportToTick(0);
    }
  }

  playScore(startIfTrue) {

    if (!startIfTrue) {
      this.state.scorePlayer.stop();

      let lastNoteIds = this.state.highlightedNotes;
      if (lastNoteIds.length > 0) {
        lastNoteIds.forEach((noteId) => {
          let noteElt = document.getElementById(noteId);
          noteElt.setAttribute("style", "fill: #000");
        });
      }

      this.setState({scorePlaying: false, activeAudioNodes: {}, activeNotes: [], sustainedNotes: [], currentProgress: 0, highlightedNotes: []});
      
      return;
    }

    this.state.scorePlayer.play();
    this.setState({scorePlaying: true, activeNotes: [], totalTicks: this.state.scorePlayer.totalTicks });

  }

  /* Perhaps these "skipToX" functions could be consolidated... */

  skipToPixel(yPixel) {

    if (this.state.scorePlaying) {
      return;
    }

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
    if (!(this.state.samplePlayer || this.state.scorePlayer)) {
      return;
    }

    let playTick = Math.max(0, targetTick);
    let playProgress = Math.max(0, targetProgress);

    if (this.state.scorePlaying) {
      this.state.scorePlayer.pause();
      this.state.scorePlayer.skipToTick(playTick);
      this.setState({ activeAudioNodes: {}, activeNotes: [], sustainedNotes: [], currentProgress: playProgress });
      this.state.scorePlayer.play();
      return;
    }

    const pedalsOn = this.state.pedalMap.search(playTick, playTick);

    let sustainPedalOn = this.state.sustainPedalLocked || pedalsOn.includes("sustain");
    let softPedalOn = this.state.softPedalLocked || pedalsOn.includes("soft");

    if (this.state.samplePlayer.isPlaying()) {
      this.state.samplePlayer.pause();
      this.state.samplePlayer.skipToTick(playTick);
      this.setState({ activeAudioNodes: {}, activeNotes: [], sustainedNotes: [], currentProgress: playProgress });
      this.state.samplePlayer.play();
    } else {
      this.state.samplePlayer.skipToTick(playTick);
      this.panViewportToTick(targetTick);
    }
    this.setState({ sustainPedalOn, softPedalOn });
  }

  updateTempoSlider(event) {

    const playbackTempo = event.target.value * this.state.tempoRatio;

    if (this.state.scorePlaying) {
      this.state.scorePlayer.pause();
      this.state.scorePlayer.setTempo(playbackTempo);
      this.state.scorePlayer.play();
      this.setState({sliderTempo: event.target.value, playbackTempo});
      return;
    }

    // If not paused during tempo change, player jumps back a bit on
    // shift to slower playback tempo, forward on shift to faster tempo.
    // So we pause it.
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

      function decodeCharRefs(string) {
        return string
            .replace(/&#(\d+);/g, function(match, num) {
                return String.fromCodePoint(num);
            })
            .replace(/&#x([A-Za-z0-9]+);/g, function(match, num) {
                return String.fromCodePoint(parseInt(num, 16));
            });
      }

      this.state.osdRef.current.openSeadragon.viewport.fitHorizontally(true);

      let viewportBounds = this.state.osdRef.current.openSeadragon.viewport.getBounds();
  
      // This will do a "dry run" of the playback and set all event timings.
      // Should already done by this point... (?)
      //MidiSamplePlayer.fileLoaded();

      let firstHolePx = 0;
      let lastHolePx = 0;
      let holeWidthPx = 0;
      let baseTempo = null;
      let earliestTempoTick = null;
      let rollMetadata = {};
      const metadataRegex = /^@(?<key>[^:]*):[\t\s]*(?<value>.*)$/;

      let pedalMap = new IntervalTree();

      // Pedal events should be duplicated on each track, but best not to assume
      // this will always be the case. Assume however that the events are
      // always temporally ordered in each track.
      MidiSamplePlayer.events.forEach((track) => {
        let sustainOn = false;
        let softOn = false;
        let sustainStart = 0;
        let softStart = 0;
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
          } else if (event.name === "Set Tempo") {
            if ((earliestTempoTick === null) || (event.tick < earliestTempoTick)) {
              baseTempo = event.data;
              earliestTempoTick = event.tick;
            }
          } else if (event.name === "Text Event") {
            let text = decodeCharRefs(event.string);
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

  }

  midiEvent(event) {
    // Do something when a MIDI event is fired.
    // (this is the same as passing a function to MidiPlayer.Player() when instantiating).
    if (event.name === 'Note on') {

      const noteNumber = event.noteNumber;
      //const noteName = this.getNoteName(noteNumber);
      let noteVelocity = event.velocity;
      let activeAudioNodes = {...this.state.activeAudioNodes};
      let activeNotes = [...this.state.activeNotes];
      let sustainedNotes = [...this.state.sustainedNotes];

      // Note off
      if (noteVelocity === 0) {
        if ((noteNumber in this.state.activeAudioNodes) && (!this.state.sustainedNotes.includes(noteNumber))) {
          try {
            activeAudioNodes[noteNumber].stop();
          } catch {
            console.log("COULDN'T STOP NOTE, PROBABLY DUE TO WEIRD ADSR VALUES, RESETTING");
            this.setState({ adsr: ADSR_SAMPLE_DEFAULTS });
          }
          activeAudioNodes[noteNumber] = null;
        }
        while(activeNotes.includes(parseInt(noteNumber))) {
          activeNotes.splice(activeNotes.indexOf(parseInt(noteNumber)), 1);
        }
        this.setState({ activeAudioNodes, activeNotes });
      
      // Note on
      } else {
        if (sustainedNotes.includes(noteNumber)) {
          try {
            activeAudioNodes[noteNumber].stop();
          } catch {
            console.log("Tried and failed to stop sustained note being re-touched",noteNumber);
          }
          activeAudioNodes[noteNumber] = null;
        }

        let updatedVolume = noteVelocity/100.0 * this.state.volumeRatio;
        if (this.state.softPedalOn) {
          updatedVolume *= SOFT_PEDAL_RATIO;
        }
        if (parseInt(noteNumber) < this.state.panBoundary) {
          updatedVolume *= this.state.leftVolumeRatio;
        } else if (parseInt(noteNumber) >= this.state.panBoundary) {
          updatedVolume *= this.state.rightVolumeRatio;
        }

        try {
          let adsr = [this.state.adsr['attack'], this.state.adsr['decay'], this.state.adsr['sustain'], this.state.adsr['release']];
          
          let noteNode = this.state.instrument.play(noteNumber, this.state.ac.currentTime, { gain: updatedVolume, adsr });
          activeAudioNodes[noteNumber] = noteNode;
        } catch {
          // Get rid of this eventually
          console.log("IMPOSSIBLE ADSR VALUES FOR THIS NOTE, RESETTING");
          let adsr = [ADSR_SAMPLE_DEFAULTS['attack'], ADSR_SAMPLE_DEFAULTS['decay'], ADSR_SAMPLE_DEFAULTS['sustain'], ADSR_SAMPLE_DEFAULTS['release']];
          let noteNode = this.state.instrument.play(noteNumber, this.state.ac.currentTime, { gain: updatedVolume, adsr });
          activeAudioNodes[noteNumber] = noteNode;
          this.setState({adsr: ADSR_SAMPLE_DEFAULTS});
        }
        if (this.state.sustainPedalOn && !sustainedNotes.includes(noteNumber)) {
          sustainedNotes.push(noteNumber);
        }
        if (!activeNotes.includes(noteNumber)) {
          activeNotes.push(parseInt(noteNumber));
        }
        this.setState({activeAudioNodes, activeNotes, sustainedNotes});
      }
    } else if (event.name === "Controller Change") {
      // Controller Change number=64 is a sustain pedal event;
      // 127 is down (on), 0 is up (off)
      if ((event.number == 64) && !this.state.sustainPedalLocked) {
        if (event.value == 127) {
          this.sustainPedalOn();
        } else if (event.value == 0) {
          this.sustainPedalOff();
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

  sustainPedalOn() {
    let sustainedNotes = [...this.state.sustainedNotes];
    // XXX Lazy state updates mean that sustainedNotes may not be cleared
    // by the next pedal on event
    if (this.state.sustainPedalOn) {
      this.sustainPedalOff();
      sustainedNotes = [];
    }
    this.state.activeNotes.forEach((noteNumber) => {
      if (!sustainedNotes.includes(noteNumber)) {
        sustainedNotes.push(noteNumber)
      }
    });
    this.setState({ sustainPedalOn: true, sustainedNotes });
  }

  sustainPedalOff() {
    let activeAudioNodes = {...this.state.activeAudioNodes};
    this.state.sustainedNotes.forEach((noteNumber) => {
      if (!(this.state.activeNotes.includes(parseInt(noteNumber)))) {
        // XXX Maybe use a slower release velocity for pedal events?
        try {
          this.state.activeAudioNodes[noteNumber].stop();
        } catch {
          console.log("FAILED TO UNSUSTAIN",noteNumber);
        }
        activeAudioNodes[noteNumber] = null;
      }
    });
    this.setState({ sustainPedalOn: false, activeAudioNodes, sustainedNotes: [] });
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
  midiNotePlayer(noteNumber, onIfTrue /*, prevActiveNotes*/) {

    if (onIfTrue) {
      let updatedVolume = DEFAULT_NOTE_VELOCITY/100.0 * this.state.volumeRatio;
      if (this.state.softPedalOn) {
        updatedVolume *= SOFT_PEDAL_RATIO;
      }
      if (parseInt(noteNumber) < HALF_BOUNDARY) {
        updatedVolume *= this.state.leftVolumeRatio;
      } else if (parseInt(noteNumber) >= HALF_BOUNDARY) {
        updatedVolume *= this.state.rightVolumeRatio;
      }
      if (noteNumber in this.state.activeAudioNodes) {
        try {
          this.state.activeAudioNodes[noteNumber].stop();
        } catch {
          console.log("Keyboard tried and failed to stop playing note to replace it",noteNumber);
        }
      }
      if (this.state.sustainPedalOn && !this.state.sustainedNotes.includes(noteNumber)) {
        this.setState({ sustainedNotes: [...this.state.sustainedNotes, noteNumber ]});
      }
      const audioNode = this.state.instrument.play(noteNumber, this.state.ac.currentTime, {gain: updatedVolume});
      this.setState({
        activeAudioNodes: Object.assign({}, this.state.activeAudioNodes, {
          [noteNumber]: audioNode,
        }),
      });
    } else {
        if (!this.state.activeAudioNodes[noteNumber] || (this.state.sustainPedalOn && this.state.sustainedNotes.includes(noteNumber))) {
          return;
        }
        const audioNode = this.state.activeAudioNodes[noteNumber];
        audioNode.stop();
        this.setState({
          activeAudioNodes: Object.assign({}, this.state.activeAudioNodes, {
            [noteNumber]: null,
          }),
        });
    }
  }

  getNoteName(noteNumber) {
    const octave = parseInt(noteNumber / 12) - 1;
    noteNumber -= 21;
    const name = SHARP_NOTES[noteNumber % 12];
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
    let noteNumber = NaN;
    if (SHARP_NOTES.includes(note)) {
      noteNumber = ((octave - 1) * 12) + SHARP_NOTES.indexOf(note) + 21; 
    } else if (FLAT_NOTES.includes(note)) {
      noteNumber = ((octave -1) * 12) + FLAT_NOTES.indexOf(note) + 21; 
    }
    return noteNumber;    
  }

  togglePedalLock(event) {
    const pedalName = event.target.name;
    if (pedalName === "sustain") {
      if (this.state.sustainPedalLocked) {
        // Release sustained notes
        this.setState({sustainPedalLocked: false });
        this.sustainPedalOff();
      } else {
        this.setState({sustainPedalLocked: true });
        this.sustainPedalOn();
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
              <strong>Label:</strong> {this.state.rollMetadata['LABEL']}<br />
              <strong>PURL:</strong> <a href={this.state.rollMetadata['PURL']}>{this.state.rollMetadata['PURL']}</a><br />
              <strong>Call No:</strong> {this.state.rollMetadata['CALLNUM']}<br />
            </div>
            <hr />
            <div>Progress: <input disabled={this.state.scorePlaying} type="range" min="0" max="1" step=".01" value={this.state.currentProgress} className="slider" id="progress" onChange={this.skipToProgress} /> {(this.state.currentProgress * 100.).toFixed(2)+"%"} </div>
          </div>
          <div>
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
            <hr />
          </div>
        </div>  
        <div className="flex-container" style={{display: "flex", flexDirection: "row", justifyContent: "space-between", width: "1000px" }}>
          <div>
            <MultiViewer
              height="700px"
              width="500px"
              iiifUrls={[IMAGE_URL]}
              showToolbar={false}
              backdoor={this.getOSDref}
            />
          </div>
          <div className="score">
            <div>
              Score playback:
              <button id="play_score_page" disabled={this.state.scorePlaying || this.state.playState !== "stopped"} name="play_page" onClick={() => {this.playScore(true)}}>Start</button>
              <button id="stop_score_page" disabled={!this.state.scorePlaying || this.state.playState !== "stopped"} name="stop_page" onClick={() => {this.playScore(false)}}>Stop</button>
            </div>
            <div>
              Score pages:
              <button id="prev_score_page" disabled={this.state.scorePlaying || this.state.currentScorePage == 1} name="prev_page" onClick={() => {this.setState({currentScorePage: this.state.currentScorePage-1})}}>Prev</button>
              <button id="next_score_page" disabled={this.state.scorePlaying || this.state.currentScorePage == this.state.scorePages.length + 1} name="next_page" onClick={() => {this.setState({currentScorePage: this.state.currentScorePage+1})}}>Next</button>
            </div>
            {this.state.scorePages[this.state.currentScorePage-1]}
            {/* <img style={{"width": "500px"}} src={fz_p1}/> */}
          </div>
        </div>
        <Piano
          noteRange={{ first: 21, last: 108 }}
          playNote={(noteNumber) => {
            //this.midiNotePlayer(noteNumber, true);
          }}
          stopNote={(noteNumber) => {
            //this.midiNotePlayer(noteNumber, false);
          }}
          width={1000}
          onPlayNoteInput={(noteNumber) => {
            this.midiNotePlayer(noteNumber, true);
          }}
          onStopNoteInput={(noteNumber) => {
            this.midiNotePlayer(noteNumber, false);
          }}
          // keyboardShortcuts={keyboardShortcuts}
          activeNotes={this.state.activeNotes}
        />
        <div style={{width: "1000px"}}>
          <button id="soft_pedal" name="soft" onClick={this.togglePedalLock} style={{background: (this.state.softPedalOn ? "lightblue" : "white")}}>SOFT</button>
          <button id="sustain_pedal" name="sustain" onClick={this.togglePedalLock} style={{background: (this.state.sustainPedalOn ? "lightblue" : "white")}}>SUST</button>
        </div>
        <div className="flex-container" style={{display: "flex", flexDirection: "row", justifyContent: "space-evenly", width: "1000px" }}>
          <button id="pause" disabled={this.state.scorePlaying} onClick={this.playPauseSong} style={{background: (this.state.playState === "paused" ? "lightgray" : "white")}}>Play/Pause</button>
          <button id="stop" disabled={this.state.scorePlaying} onClick={this.stopSong} style={{background: "white"}}>Stop</button>
          <div>Tempo: <input type="range" min="0" max="180" value={this.state.sliderTempo} className="slider" id="tempoSlider" onChange={this.updateTempoSlider} /> {this.state.sliderTempo} bpm</div>
          <div>Master Volume: <input type="range" min="0" max="4" step=".1" value={this.state.volumeRatio} className="slider" id="masterVolumeSlider" name="volume" onChange={this.updateVolumeSlider} /> {this.state.volumeRatio}</div>
          <div>Bass Volume: <input type="range" min="0" max="4" step=".1" value={this.state.leftVolumeRatio} className="slider" id="leftVolumeSlider" name="left" onChange={this.updateVolumeSlider} /> {this.state.leftVolumeRatio}</div>
          <div>Treble Volume: <input type="range" min="0" max="4" step=".1" value={this.state.rightVolumeRatio} className="slider" id="rightVolumeSlider" name="right" onChange={this.updateVolumeSlider} /> {this.state.rightVolumeRatio}</div>
        </div>
      </div>
    );
  }
}

export default App;
