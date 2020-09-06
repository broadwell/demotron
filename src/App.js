import React, { Component } from 'react';
import './App.css';

import MidiPlayer from "midi-player-js";
import Soundfont from "soundfont-player";
import MultiViewer from "./react-iiif-viewer/src/components/MultiViewer";
import OpenSeadragon from 'openseadragon';
import { Piano, KeyboardShortcuts } from 'react-piano';
import 'react-piano/dist/styles.css';

const ADSR_SAMPLE_DEFAULTS = { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.3 };
const UPDATE_INTERVAL_MS = 100;
const SHARP_NOTES = ["A", "A#", "B", "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#"];
const FLAT_NOTES = ["A", "Bb", "B", "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab"];
const SOFT_PEDAL_RATIO = .67;

class App extends Component {
  constructor(props) {
    super(props);

    this.state = {
      activeNotes: [], // For the piano viz; these should be MIDI numbers
      currentSong: null,
      samplePlayer: null,
      playState: "stopped",
      instrument: null,
      baseTempo: null,
      gainNode: null,
      adsr: ADSR_SAMPLE_DEFAULTS,
      totalTicks: 0,
      sampleInst: 'acoustic_grand_piano',
      lastNotes: {}, // To handle velocity=0 "note off" events
      volumeRatio : 1.0,
      tempoRatio: 1.0, // To keep track of gradual roll acceleration
      sliderTempo: 60.0,
      ac: null,
      currentTick: 0,
      currentProgress: 0.0,
      osdRef: null,
      firstHolePx: 0,
      playTimer: null,
      sustainPedalOn: false,
      softPedalOn: false,
      sustainPedalLocked: false,
      softPedalLocked: false,
      sustainedNotes: {}
    }

    this.midiEvent = this.midiEvent.bind(this);
    this.changeInstrument = this.changeInstrument.bind(this);
    this.playPauseSong = this.playPauseSong.bind(this);
    this.stopSong = this.stopSong.bind(this);
    this.initInstrument = this.initInstrument.bind(this);
    this.dataURItoBlob = this.dataURItoBlob.bind(this);
    this.updateTempoSlider = this.updateTempoSlider.bind(this);
    this.updateVolumeSlider = this.updateVolumeSlider.bind(this);
    this.updateADSR = this.updateADSR.bind(this);
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
        
    //this.setState({baseTempo: midiData.header.tempos[0]['bpm'], sliderTempo: midiData.header.tempos[0]['bpm']}));

    // Instantiate the sample-based player
    // It's possible to load a local soundfont via the soundfont-player,
    // sample-player, audio-loader toolchain. This is much easier to do
    // if the soundfont is in Midi.js format
    Soundfont.instrument(ac, this.state.sampleInst, { soundfont: 'MusyngKite' }).then(this.initInstrument);
    //Soundfont.instrument(ac, "http://localhost/~pmb/demotron/salamander_acoustic_grand-mod-ogg.js" ).then(this.initInstrument);
  }

  getOSDref(osdRef) {
    //console.log(osdRef);
    this.setState({osdRef});
    /*
    console.log(osdRef.current.openSeadragon.viewport._contentSize);
    console.log(osdRef.current.openSeadragon.viewport.getZoom());
    console.log(osdRef.current.openSeadragon.viewport.getMaxZoom());
    console.log(osdRef.current.openSeadragon.viewport.getMinZoom());
    console.log(osdRef.current.openSeadragon.viewport.getBounds());
    console.log(osdRef.current.openSeadragon.viewport.getBoundsWithMargins());
    console.log(osdRef.current.openSeadragon.viewport.getHomeBounds());
    console.log(osdRef.current.openSeadragon.viewport.getHomeZoom());
    console.log(osdRef.current.openSeadragon.viewport.getAspectRatio());
    osdRef.current.openSeadragon.viewport.fitVertically(true);
    let center = osdRef.current.openSeadragon.viewport.getCenter();
    console.log(center);
    //var bounds = new OpenSeadragon.Rect(0.25, 0.25, 0.5, 0.5, 0);
    //osdRef.current.openSeadragon.viewport.fitBounds(bounds, true);
    console.log(osdRef.current.openSeadragon.viewport.containerSize);
    console.log(osdRef.current.openSeadragon.viewport.imageToViewportCoordinates(100,100));
    //osdRef.current.openSeadragon.viewport.zoomBy(1);
    osdRef.current.openSeadragon.viewport.viewer.addHandler("zoom", (e) => {console.log(e)});
    //osdRef.current.openSeadragon.viewport.zoomTo(3, null, true);
    */
  }

  /* Converts MIDI data for use with Tonejs */
  dataURItoBlob(dataURI) {
    // convert base64/URLEncoded data component to raw binary data held in a string
    var byteString;
    if (dataURI.split(',')[0].indexOf('base64') >= 0)
        byteString = atob(dataURI.split(',')[1]);
    else
        byteString = unescape(dataURI.split(',')[1]);
  
    // separate out the mime component
    var mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
  
    // write the bytes of the string to a typed array
    var ia = new Uint8Array(byteString.length);
    for (var i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
  
    return new Blob([ia], {type:mimeString});
  }

  playPauseSong() {

    if (this.state.samplePlayer.isPlaying()) {
      this.state.samplePlayer.pause();
      this.setState({ playState: "paused" });
    } else {
      let playTimer = setInterval(this.panViewportToTick, UPDATE_INTERVAL_MS);
      this.setState({ playTimer, playState: "playing" });
      this.state.samplePlayer.play();
    }
  }

  stopSong() {
    if (this.state.samplePlayer.isPlaying()) {

      this.state.samplePlayer.stop();
      clearInterval(this.state.playTimer);
      this.setState({ playState: "stopped", playTimer: null, lastNotes: {}, activeNotes: [], sustainedNotes: {} });
    }
  }

  skipTo(event) {
    if (!this.state.samplePlayer) {
      return;
    }
    const targetProgress = event.target.value;
    const targetTick = parseInt(targetProgress * parseFloat(this.state.totalTicks));

    this.setState({currentProgress: targetProgress});
    if (this.state.samplePlayer.isPlaying()) {
      this.state.samplePlayer.pause();
      this.state.samplePlayer.skipToTick(targetTick);
      this.setState({ lastNotes: {}, activeNotes: [], sustainedNotes: {} });
      this.state.samplePlayer.play();
    } else {
      this.state.samplePlayer.skipToTick(targetTick);
    }
  }

  updateTempoSlider(event) {
    this.setState({sliderTempo: event.target.value});
    const playbackTempo = event.target.value * this.state.tempoRatio;
    this.state.samplePlayer.setTempo(playbackTempo);
  }

  updateVolumeSlider(event) {
    this.setState({volumeRatio: event.target.value});
  }

  updateADSR(event) {
    let adsr = {...this.state.adsr};
    adsr[event.target.id] = event.target.value;
    this.setState({adsr});
  }

  /* SAMPLE-BASED PLAYBACK USING midi-player-js AND soundfont-player */

  initInstrument(inst) {

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
    // May need to look ahead to find starting tempo...
    /*console.log(Player.getTotalTicks()); // Doesn't work, but Player.totalTicks does
    console.log(Player.tracks);
    console.log(Player.events);
    */
    this.state.osdRef.current.openSeadragon.viewport.fitHorizontally(true);
    //console.log("CONTENT SIZE",this.state.osdRef.current.openSeadragon.viewport._contentSize);
    let viewportBounds = this.state.osdRef.current.openSeadragon.viewport.getBounds();
    //console.log("BOUNDS", viewportBounds);
    let fittedViewportZoom = this.state.osdRef.current.openSeadragon.viewport.getZoom();
    //console.log("ZOOM",fittedViewportZoom);
    // This will do a "dry run" of the playback and set all event timings.
    // May be useful, but not necessary at the moment.
    //MidiSamplePlayer.fileLoaded();
    //console.log(MidiSamplePlayer.events);
    let firstHolePx = 0;
    let lastHolePx = 0;
    let holeWidthPx = 0;
    let baseTempo = null;
    let earliestTempoTick = null;

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
        * Other potentially useful values:
        * @ROLL_WIDTH (this is smaller than the image width)
        * @HARD_MARGIN_TREBLE
        * @HARD_MARGIN_BASS
        * @HOLE_SEPARATION
        * @HOLE_OFFSET
        * All of the source/performance/recording metadata is in this track as well.
        */
        if (text.startsWith('@FIRST_HOLE:')) {
          firstHolePx = parseInt(text.split("\t")[2].replace("px",""));
          //console.log("FIRST HOLE:",firstHolePx);
        } else if (text.startsWith('@LAST_HOLE:')) {
          lastHolePx = parseInt(text.split("\t")[2].replace("px",""));
          //console.log("LAST HOLE:",lastHolePx);
        } else if (text.startsWith('@AVG_HOLE_WIDTH:')) {
          holeWidthPx = parseInt(text.split("\t")[1].replace("px",""));
          //console.log("HOLE WIDTH:",holeWidthPx);
        }
      }
    });

    //console.log(this.state.osdRef.current.openSeadragon);

    let firstLineViewport = this.state.osdRef.current.openSeadragon.viewport.imageToViewportCoordinates(0,firstHolePx);
    //console.log("VIEWPORT COORDS OF FIRST HOLE LINE",firstLineViewport);
    let firstLineCenter = new OpenSeadragon.Point(viewportBounds.width / 2.0, firstLineViewport.y);

    //this.state.osdRef.current.openSeadragon.viewport.panTo(firstLineCenter);
    let bounds = new OpenSeadragon.Rect(0.0,firstLineViewport.y - (viewportBounds.height / 2.0),viewportBounds.width, viewportBounds.height);
    this.state.osdRef.current.openSeadragon.viewport.fitBounds(bounds, true);

    viewportBounds = this.state.osdRef.current.openSeadragon.viewport.getBounds();
    //console.log("UPDATED BOUNDS",viewportBounds);
    let playPoint = new OpenSeadragon.Point(0, viewportBounds.y + (viewportBounds.height / 2.0));
    //console.log(playPoint);

    let playLine = this.state.osdRef.current.openSeadragon.viewport.viewer.getOverlayById('play-line');
    if (!playLine) {
      playLine = document.createElement("div");
      playLine.id = "play-line";
      this.state.osdRef.current.openSeadragon.viewport.viewer.addOverlay(playLine, playPoint, OpenSeadragon.Placement.TOP_LEFT);
    } else {
      playLine.update(playPoint, OpenSeadragon.Placement.TOP_LEFT);
    }
    this.setState({samplePlayer: MidiSamplePlayer, instrument: inst, totalTicks: MidiSamplePlayer.totalTicks, firstHolePx, baseTempo});
    //console.log("TOTAL TICKS:",MidiSamplePlayer.totalTicks);
    //console.log("SONG TIME:",MidiSamplePlayer.getSongTime());

  }

  midiEvent(event) {
    // Do something when a MIDI event is fired.
    // (this is the same as passing a function to MidiPlayer.Player() when instantiating).
    if (event.name === 'Note on') {
      //console.log("NOTE ON EVENT AT", this.state.ac.currentTime, event.tick);
      //console.log(event);

      const noteName = event.noteName;
      const noteNumber = event.noteNumber;
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
        activeNotes.splice(activeNotes.indexOf(noteNumber), 1);
        this.setState({ lastNotes, activeNotes });
      } else {
        let updatedVolume = noteVelocity/100.0 * this.state.volumeRatio;
        if (this.state.softPedalOn) {
          updatedVolume *= SOFT_PEDAL_RATIO;
        }
        //let lastNotes = Object.assign({}, this.state.lastNotes);
        // Play a note -- can also set ADSR values in the opts, could be used to simulate pedaling
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
          this.changeSustainPedal(false);
        } else if (event.value == 0) {
          this.changeSustainPedal(true);
        }
      // 67 is the soft (una corda) pedal
      } else if (event.number == 67) {
        if (event.value == 127) {
          this.setState({ softPedalOn: true });
        } else if (event.value == 0) {
          this.setState({ softPedalOn: false });
        }
      }
    } else if (event.name === "Set Tempo") {
      const tempoRatio = 1 + (parseFloat(event.data) - parseFloat(this.state.baseTempo)) / parseFloat(this.state.baseTempo);
      const playbackTempo = parseFloat(this.state.sliderTempo) * tempoRatio;
      
      this.state.samplePlayer.setTempo(playbackTempo);
      this.setState({speedupFactor: tempoRatio});
    }

    this.panViewportToTick(event.tick);

  }

  changeSustainPedal(trueIfOn) {
    if (trueIfOn) {
      let sustainedNotes = {};
      this.state.activeNotes.forEach((noteNumber) => {
        const noteName = this.getNoteName(noteNumber);
        sustainedNotes[noteName] = this.state.lastNotes[noteName];
        // XXX Why are so many of these undefined?
        //console.log("SUSTAINING",noteName,sustainedNotes[noteName]);
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
          //console.log("RELEASING",noteName,this.state.sustainedNotes[noteName]);
          // XXX Maybe use a slower release velocity for pedal events?
          if (typeof(this.state.sustainedNotes[noteName].stop === 'function')) {
            this.state.sustainedNotes[noteName].stop();
          }
          delete lastNotes[noteName];
        }
      });
      this.setState({ sustainPedalOn: false, sustainedNotes: {}, lastNotes });
    }
  }

  panViewportToTick(tick) {
    /* PAN VIEWPORT IMAGE */
    // Do we want to prevent user from panning/zooming image?
    // Ideally they would only be prevented from doing so during playback.
    // Disable controls then, or just re-pan and zoom the viewer at each event?

    if (isNaN(tick) || (tick === null)) {
      tick = this.state.samplePlayer.getCurrentTick();
    }

    //this.state.osdRef.current.openSeadragon.viewport.fitHorizontally(true);
    let viewportBounds = this.state.osdRef.current.openSeadragon.viewport.getBounds();
    //console.log("BOUNDS", viewportBounds);

    let linePx = this.state.firstHolePx + tick; // Craig says this will work
    //console.log("IMAGE Y COORD OF LINE IN PX",linePx);

    let lineViewport = this.state.osdRef.current.openSeadragon.viewport.imageToViewportCoordinates(0,linePx);
    //console.log("VIEWPORT COORDS OF HOLE LINE",lineViewport);
    let lineCenter = new OpenSeadragon.Point(viewportBounds.width / 2.0, lineViewport.y);
    this.state.osdRef.current.openSeadragon.viewport.panTo(lineCenter);

    let playLine = this.state.osdRef.current.openSeadragon.viewport.viewer.getOverlayById('play-line');

    playLine.update(lineViewport, OpenSeadragon.Placement.TOP_LEFT);

    let currentProgress = parseFloat(tick) / this.state.totalTicks;

    this.setState({currentTick: tick, currentProgress});

  }

  changeInstrument(e) {
    this.stopSong();
    this.setState({sampleInst: e.target.value});
    Soundfont.instrument(this.state.ac, e.target.value, { soundfont: 'FluidR3_GM' }).then(this.initInstrument);
  }

  midiNotePlayer(midiNote, trueIfOn) {
    // XXX Need better behavior when keyboard is clicked during playback
    if (this.state.samplePlayer.isPlaying()) {
      return;
    }
    let lastNotes = {...this.state.lastNotes};
    let activeNotes = [...this.state.activeNotes];
    const noteName = this.getNoteName(midiNote);
    if (trueIfOn) {
      let noteNode = this.state.instrument.play(noteName, this.state.ac.currentTime, /*{ gain: updatedVolume, adsr }*/);
      lastNotes[noteName] = noteNode;
      activeNotes.push(midiNote);
    } else {
      let noteNode = lastNotes[noteName];
      try {
        noteNode.stop();
        delete lastNotes[noteName];
      } catch {
        console.log("TRIED TO STOP NONEXISTENT NOTE");
      }
      activeNotes.splice(activeNotes.indexOf(midiNote), 1);
    }
    this.setState({ lastNotes, activeNotes });
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

    //const manifestUrl = "https://purl.stanford.edu/dj406yq6980/iiif/manifest";
    const imageUrl = "https://stacks.stanford.edu/image/iiif/dj406yq6980%252Fdj406yq6980_0001/info.json";

    //let currentTime = (this.state.ac == null) ? 0 : this.state.ac.currentTime;

    let tempoSlider = <input type="range" min="0" max="180" value={this.state.sliderTempo} className="slider" id="tempoSlider" onChange={this.updateTempoSlider} />;
    let volumeSlider = <input type="range" min="0" max="2" step=".1" value={this.state.volumeRatio} className="slider" id="tempoSlider" onChange={this.updateVolumeSlider} />;

    let tempoControl = "";
    let volumeControl =  <div>Volume: {volumeSlider} {this.state.volumeRatio}</div>;

    tempoControl = <div>Tempo: {tempoSlider} {this.state.sliderTempo} bpm</div>;

    /*
    let pctRemaining = 100;
    if (this.state.samplePlayer !== null) {
      pctRemaining = this.state.samplePlayer.getSongPercentRemaining().toFixed(2);
    }
    */

    return (
      <div className="App">
        <div>
          <button id="pause" onClick={this.playPauseSong} style={{background: (this.state.playState === "paused" ? "lightgray" : "white")}}>Play/Pause</button>
          <button id="stop" onClick={this.stopSong} style={{background: "white"}}>Stop</button>
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
          <div style={{float: "right"}}>ADSR envelope (experimental):
            <div>Attack: <input disabled type="range" min="0" max=".02" step=".01" value={this.state.adsr['attack']} className="slider" id="attack" onChange={this.updateADSR}/> {this.state.adsr['attack']}</div>
            <div>Decay: <input disabled type="range" min="0" max=".1" step=".01" value={this.state.adsr['decay']} className="slider" id="decay" onChange={this.updateADSR}/> {this.state.adsr['decay']}</div>
            <div>Sustain: <input type="range" min="0" max="5" step=".1" value={this.state.adsr['sustain']} className="slider" id="sustain" onChange={this.updateADSR}/> {this.state.adsr['sustain']}</div>
            <div>Release: <input disabled type="range" min="0" max="1" step=".1" value={this.state.adsr['release']} className="slider" id="release" onChange={this.updateADSR}/> {this.state.adsr['release']}</div>          
          </div>
          {tempoControl}
          {volumeControl}
          <div>Progress: <input type="range" min="0" max="1" step=".01" value={this.state.currentProgress} className="slider" id="progress" onChange={this.skipTo}/> {(this.state.currentProgress * 100.).toFixed(2)+"%"} </div>
        </div>
        <Piano
          noteRange={{ first: 21, last: 108 }}
          playNote={(midiNumber) => {
            this.midiNotePlayer(midiNumber, true);
          }}
          stopNote={(midiNumber) => {
            this.midiNotePlayer(midiNumber, false);
          }}
          width={1000}
          // keyboardShortcuts={keyboardShortcuts}
          activeNotes={this.state.activeNotes}
        />
        <button id="soft_pedal" name="soft" onClick={this.togglePedalLock} style={{background: (this.state.softPedalOn ? "lightblue" : "white")}}>SOFT</button>
        <button id="sustain_pedal" name="sustain" onClick={this.togglePedalLock} style={{background: (this.state.sustainPedalOn ? "lightblue" : "white")}}>SUST</button>
        
        <MultiViewer
          height="800px"
          width="500px"
          iiifUrls={[imageUrl]}
          showToolbar={false}
          backdoor={this.getOSDref}
        />
      </div>
    );
  }
}

export default App;
