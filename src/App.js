import React, { Component } from 'react';
import './App.css';
import { PolySynth, Synth /*, Master */ } from 'tone';
import { Midi } from '@tonejs/midi';
import MidiPlayer from "midi-player-js";
import Soundfont from "soundfont-player";
import MultiViewer from "./react-iiif-viewer/src/components/MultiViewer";
import OpenSeadragon from 'openseadragon';

const SYNTH_VOLUME = 3.0;
const ADSR_SAMPLE_DEFAULTS = { attack: 0.01, decay: 0.1, sustain: 0.9, release: 0.3 }
const ADSR_SYNTH_DEFAULTS = { attack: 0.01, decay: 0.1, sustain: 0.3, release: 1 }

class App extends Component {
  constructor(props) {
    super(props);

    this.state = {
      currentNote: "WAITING",
      currentSong: null,
      samplePlayer: null,
      synths: [],
      isPlaying: false,
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
      playbackMethod: "sample",
      midi: null,
      osdRef: null,
      firstHolePx: 0
    }

    this.midiEvent = this.midiEvent.bind(this);
    this.changeInstrument = this.changeInstrument.bind(this);
    this.playSong = this.playSong.bind(this);
    this.stopSong = this.stopSong.bind(this);
    this.initInstrument = this.initInstrument.bind(this);
    this.dataURItoBlob = this.dataURItoBlob.bind(this);
    this.getMidi = this.getMidi.bind(this);
    this.loadMidi = this.loadMidi.bind(this);
    this.synthMidi = this.synthMidi.bind(this);
    this.updateTempoSlider = this.updateTempoSlider.bind(this);
    this.updateVolumeSlider = this.updateVolumeSlider.bind(this);
    this.updateADSR = this.updateADSR.bind(this);
    this.skipTo = this.skipTo.bind(this);
    this.getOSDref = this.getOSDref.bind(this);
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

    // Instantiate the synth-based player
    this.loadMidi(this.dataURItoBlob(currentSong))
        // For now, get starting tempo from Tonejs/Midi parsing
      .then(midiData => this.setState({midi: midiData, baseTempo: midiData.header.tempos[0]['bpm'], sliderTempo: midiData.header.tempos[0]['bpm']}));

    // Instantiate the sample-based player
    // It's possible to load a local soundfont via the soundfont-player,
    // sample-player, audio-loader toolchain. This is much easier to do
    // if the soundfont is in Midi.js format
    Soundfont.instrument(ac, this.state.sampleInst, { soundfont: 'MusyngKite' }).then(this.initInstrument);
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

  playSong() {

    if (this.state.isPlaying) { return; }

    this.setState({isPlaying: true});

    if (this.state.playbackMethod === "sample") {
      this.state.samplePlayer.play();
    } else {
      this.synthMidi(this.state.midi);
    }

  }

  stopSong() {
    if (this.state.isPlaying) {
      if (this.state.playbackMethod === "sample") {
        this.state.samplePlayer.stop();
      } else { // Don't yet have a good way to deschedule synth events
               // This stops the synth from playing, but the events
               // are still there, yet the synth can't be resumed.
        this.state.synths.forEach(synth => {
          synth.output.context.dispose();
          synth.dispose();
          //Master.dispose();
        });
      }

      this.setState({isPlaying: false , synths: []});
    }
  }

  skipTo(event) {
    if (!this.state.samplePlayer) {
      return;
    }
    const targetProgress = event.target.value;
    const targetTick = parseInt(targetProgress * parseFloat(this.state.totalTicks));

    this.setState({currentProgress: targetProgress});
    if (this.state.isPlaying) {
      this.state.samplePlayer.stop();
      this.state.samplePlayer.skipToTick(targetTick);
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

    this.state.synths.forEach(synth => {

      // Synth volume is in decibels, so volume=0 is still audible.
      // There are better ways to do this, but we probably won't
      // be using synth sound anyway, so why bother.
      synth.volume.value = SYNTH_VOLUME * event.target.value;

    });

  }

  updateADSR(event) {
    let adsr = {...this.state.adsr};
    adsr[event.target.id] = event.target.value;
    this.setState({adsr});

    if (this.state.playbackMethod !== "sample") {
      this.state.synths.forEach(synth => {
        synth.options.envelope = adsr;
      });
    }
  }

  /* SAMPLE-BASED PLAYBACK USING midi-player-js AND soundfont-player */

  initInstrument(inst) {

    /* Instantiate the MIDI player */
    let MidiSamplePlayer = new MidiPlayer.Player();

    /* Various event handlers, mostly used for debugging */

    // This is how to know when a note sample has finished playing
    inst.on('ended', function (when, name) {
      //console.log('ended', name)
    });

    MidiSamplePlayer.on('fileLoaded', function() {
      console.log("data loaded");
    });
    
    MidiSamplePlayer.on('playing', function(currentTick) {
        //console.log(currentTick);
        // Do something while player is playing
        // (this is repeatedly triggered within the play loop)
    });
    
    MidiSamplePlayer.on('midiEvent', this.midiEvent);
    
    MidiSamplePlayer.on('endOfFile', function() {
        console.log("END OF FILE");
        // Do something when end of the file has been reached.
    });

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
    MidiSamplePlayer.events[0].forEach((event) => {
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

    var playLine = document.createElement("div");
    playLine.id = "play-line";

    this.state.osdRef.current.openSeadragon.viewport.viewer.addOverlay(playLine, playPoint, OpenSeadragon.Placement.TOP_LEFT);

    this.setState({samplePlayer: MidiSamplePlayer, instrument: inst, totalTicks: MidiSamplePlayer.totalTicks, firstHolePx});
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
      let noteVelocity = event.velocity;

      /* XXX midi-player-js nullifies the velocity (volume) of any note that
       * is repeated before its previous instance has ended, for some reason.
       * Quick-fix hack for now is to assign it the same velocity as its
       * previous instance. This needs to work better, obviously. */
      if (noteVelocity === 0) {
        if (noteName in this.state.lastNotes) {
          let noteNode = this.state.lastNotes[noteName]
          try {
            noteNode.stop();
          } catch {
            console.log("COULDN'T STOP NOTE, PROBABLY DUE TO WEIRD ADSR VALUES, RESETTING");
            let lastNotes = {...this.state.lastNotes};
            delete lastNotes[noteName];
            this.setState({ lastNotes, adsr: ADSR_SAMPLE_DEFAULTS });
          }
        }
      } else {
        const updatedVolume = noteVelocity/100 * this.state.volumeRatio;
        let lastNotes = Object.assign({}, this.state.lastNotes);
        // Play a note -- can also set ADSR values in the opts, could be used to simulate pedaling
        try {
          let adsr = [this.state.adsr['attack'], this.state.adsr['decay'], this.state.adsr['sustain'], this.state.adsr['release']];
          let noteNode = this.state.instrument.play(noteName, this.state.ac.currentTime, { gain: updatedVolume, adsr });
          lastNotes[noteName] = noteNode;
        } catch {
          console.log("IMPOSSIBLE ADSR VALUES FOR THIS NOTE, RESETTING");
          let adsr = [ADSR_SAMPLE_DEFAULTS['attack'], ADSR_SAMPLE_DEFAULTS['decay'], ADSR_SAMPLE_DEFAULTS['sustain'], ADSR_SAMPLE_DEFAULTS['release']];
          let noteNode = this.state.instrument.play(noteName, this.state.ac.currentTime, { gain: updatedVolume, adsr });
          lastNotes[noteName] = noteNode;
          this.setState({adsr: ADSR_SAMPLE_DEFAULTS});
        }
        this.setState({currentNote: noteName, lastNotes});
      }
      
    } else if (event.name === "Set Tempo") {
      const tempoRatio = 1 + (parseFloat(event.data) - parseFloat(this.state.baseTempo)) / parseFloat(this.state.baseTempo);
      const playbackTempo = parseFloat(this.state.sliderTempo) * tempoRatio;
      
      this.state.samplePlayer.setTempo(playbackTempo);
      this.setState({speedupFactor: tempoRatio});
    }

    /* PAN VIEWPORT IMAGE */
    // Do we want to prevent user from panning/zooming image?
    // Ideally they would only be prevented from doing so during playback.
    // Disable controls then, or just re-pan and zoom the viewer at each event?
    //this.state.osdRef.current.openSeadragon.viewport.fitHorizontally(true);
    let viewportBounds = this.state.osdRef.current.openSeadragon.viewport.getBounds();
    //console.log("BOUNDS", viewportBounds);

    let linePx = this.state.firstHolePx + event.tick; // Craig says this will work
    //console.log("IMAGE Y COORD OF LINE IN PX",linePx);

    let lineViewport = this.state.osdRef.current.openSeadragon.viewport.imageToViewportCoordinates(0,linePx);
    //console.log("VIEWPORT COORDS OF HOLE LINE",lineViewport);
    let lineCenter = new OpenSeadragon.Point(viewportBounds.width / 2.0, lineViewport.y);
    this.state.osdRef.current.openSeadragon.viewport.panTo(lineCenter);

    let playLine = this.state.osdRef.current.openSeadragon.viewport.viewer.getOverlayById('play-line');

    playLine.update(lineViewport, OpenSeadragon.Placement.TOP_LEFT);

    let currentProgress = parseFloat(event.tick) / this.state.totalTicks;
    this.setState({currentTick: event.tick, currentProgress});
  }

  /* SYNTH-BASED PLAYBACK USING tonejs/midi AND tonejs */
  /* We're not likely to use this, but some of the ToneJS/midi
   * functionality *may* come in handy when loading and manipulating
   * MIDI data and events.
   */

  /* Alternate way of getting data for Tonejs -- not currently used */
  getMidi(midiURL) {
    Midi.fromUrl(midiURL)
      .then(midiData => this.processMidi(midiData))
      .catch((error) => console.log(error));
  }

  async loadMidi(midiBlob) {
    return new Midi(await midiBlob.arrayBuffer());
  }

  synthMidi(midi) {

    //this.setState({midi});
  
    //synth playback
    const synths = [];
    midi.tracks.forEach(track => {
      //create a synth for each track
      const synth = new PolySynth(Synth, {
        envelope: this.state.adsr,
        /*  attack: 0.02,
          decay: 0.1,
          sustain: 0.3,
          release: 1
        }, */
        volume: SYNTH_VOLUME
      });
      synth.toDestination()
      synths.push(synth);
      //schedule all of the events
      track.notes.forEach(note => {
        synth.triggerAttackRelease(note.name, note.duration, note.time, note.velocity);
      });
    });
    this.setState({synths});
  }

  changeInstrument = e => {
    this.stopSong();
    this.setState({sampleInst: e.target.value});
    Soundfont.instrument(this.state.ac, e.target.value, { soundfont: 'FluidR3_GM' }).then(this.initInstrument);
  }

  render() {

    //const manifestUrl = "https://purl.stanford.edu/dj406yq6980/iiif/manifest";
    const imageUrl = "https://stacks.stanford.edu/image/iiif/dj406yq6980%252Fdj406yq6980_0001/info.json";

    let changePlaybackMethod = e => {
      this.stopSong();
      let adsr = ADSR_SAMPLE_DEFAULTS;
      if (e.target.id !== "sample") {
        adsr = ADSR_SYNTH_DEFAULTS;
      }
      this.setState({ playbackMethod: e.target.id, adsr });
    }

    let currentTime = (this.state.ac == null) ? 0 : this.state.ac.currentTime;
    let noteStats = "";
    if (this.state.isPlaying && (this.state.playbackMethod === "sample")) {
      noteStats = <p>Note being played: {this.state.currentNote} at {currentTime}s, tick {this.state.currentTick}</p>;
    }

    let tempoSlider = <input type="range" min="0" max="180" value={this.state.sliderTempo} className="slider" id="tempoSlider" onChange={this.updateTempoSlider} />;
    let volumeSlider = <input type="range" min="0" max="2" step=".1" value={this.state.volumeRatio} className="slider" id="tempoSlider" onChange={this.updateVolumeSlider} />;

    let tempoControl = "";
    let volumeControl =  <div>Volume: {volumeSlider} {this.state.volumeRatio}</div>;

    if (this.state.playbackMethod === "sample") {
      tempoControl = <div>Tempo: {tempoSlider} {this.state.sliderTempo} bpm</div>;
    }

    let pctRemaining = 100;
    if (this.state.samplePlayer) {
      pctRemaining = this.state.samplePlayer.getSongPercentRemaining().toFixed(2);
    }

    return (
      <div className="App">
        <div>
          <div>
            Playback type:
            <label htmlFor="sample" >
              <input
                type="checkbox"
                name="sample"
                id="sample"
                onChange={changePlaybackMethod.bind(this)}
                checked={this.state.playbackMethod === "sample"}
              />
              Samples
            </label>

            <label htmlFor="synth" >
              <input
                type="checkbox"
                name="synth"
                id="synth"
                onChange={changePlaybackMethod.bind(this)}
                checked={this.state.playbackMethod === "synth"}
              />
              Synthesis
            </label>
          </div>
          <button id="play" onClick={this.playSong}>Play</button>
          <button id="stop" onClick={this.stopSong}>Stop</button>
          <div hidden={this.state.playbackMethod !== "sample"}>
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
          <div style={{float: "right"}} hidden={this.state.playbackMethod !== "sample"}>ADSR envelope (experimental):
            <div>Attack: <input disabled type="range" min="0" max=".02" step=".01" value={this.state.adsr['attack']} className="slider" id="attack" onChange={this.updateADSR}/> {this.state.adsr['attack']}</div>
            <div>Decay: <input disabled type="range" min="0" max=".1" step=".01" value={this.state.adsr['decay']} className="slider" id="decay" onChange={this.updateADSR}/> {this.state.adsr['decay']}</div>
            <div>Sustain: <input type="range" min="0" max="5" step=".1" value={this.state.adsr['sustain']} className="slider" id="sustain" onChange={this.updateADSR}/> {this.state.adsr['sustain']}</div>
            <div>Release: <input disabled type="range" min="0" max="1" step=".1" value={this.state.adsr['release']} className="slider" id="release" onChange={this.updateADSR}/> {this.state.adsr['release']}</div>          
          </div>
          {tempoControl}
          {volumeControl}
          {noteStats}
          <div>Progress: <input hidden={this.state.playbackMethod !== "sample"} type="range" min="0" max="1" step=".01" value={this.state.currentProgress} className="slider" id="progress" onChange={this.skipTo}/> {(this.state.currentProgress * 100.).toFixed(2)+"%"}, {pctRemaining}% remaining </div>
        </div>
        <MultiViewer
          height="800px"
          width="300px"
          iiifUrls={[imageUrl]}
          showToolbar={false}
          backdoor={this.getOSDref}
        />
      </div>
    );
  }
}

export default App;
