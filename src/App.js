import React, { Component } from 'react';
import './App.css';
import { PolySynth, Synth /*, Master */ } from 'tone';
import { Midi } from '@tonejs/midi';
import MidiPlayer from "midi-player-js";
import Soundfont from "soundfont-player";
import { MultiViewer } from "react-iiif-viewer";

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
      lastVelocities: {}, // Hack to handle repeated notes (see below)
      volumeRatio : 1.0,
      tempoRatio: 1.0, // To keep track of gradual roll acceleration
      sliderTempo: 60.0,
      ac: null,
      currentTick: 0,
      playbackMethod: "sample",
      midi: null,
    }

    this.midiEvent = this.midiEvent.bind(this);
    this.playSong = this.playSong.bind(this);
    this.stopSong = this.stopSong.bind(this);
    this.initInstrument = this.initInstrument.bind(this);
    this.dataURItoBlob = this.dataURItoBlob.bind(this);
    this.getMidi = this.getMidi.bind(this);
    this.loadMidi = this.loadMidi.bind(this);
    this.synthMidi = this.synthMidi.bind(this);
    this.updateTempoSlider = this.updateTempoSlider.bind(this);
    this.updateVolumeSlider = this.updateVolumeSlider.bind(this);
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
    Soundfont.instrument(ac, 'acoustic_grand_piano', { soundfont: 'FluidR3_GM' }).then(this.initInstrument);

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

  updateTempoSlider(event) {
    this.setState({sliderTempo: event.target.value});
    const playbackTempo = event.target.value * this.state.tempoRatio;
    this.state.samplePlayer.setTempo(playbackTempo);
  }

  updateVolumeSlider(event) {
    this.setState({volumeRatio: event.target.value});
  }

  /* SAMPLE-BASED PLAYBACK USING midi-player-js AND soundfont-player */

  initInstrument(inst) {

    /* Instantiate the MIDI player */
    let Player = new MidiPlayer.Player();

    this.setState({samplePlayer: Player, instrument: inst});

    /* Various event handlers, mostly used for debugging */

    // This is how to know when a note sample has finished playing
    inst.on('ended', function (when, name) {
      //console.log('ended', name)
    })

    Player.on('fileLoaded', function() {
      console.log("data loaded");
    });
    
    Player.on('playing', function(currentTick) {
        //console.log(currentTick);
        // Do something while player is playing
        // (this is repeatedly triggered within the play loop)
    });
    
    Player.on('midiEvent', this.midiEvent);
    
    Player.on('endOfFile', function() {
        console.log("END OF FILE");
        // Do something when end of the file has been reached.
    });

    /* Load MIDI data */
    Player.loadDataUri(this.state.currentSong);
    // Need to look ahead to find starting tempo...
    /*console.log(Player.getTotalTicks()); // Doesn't work, but Player.totalTicks does
    console.log(Player.tracks);
    console.log(Player.events);
    console.log(Player.totalTicks);
    console.log(Player.getSongTime());
    */

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
        if (noteName in this.state.lastVelocities) {
          noteVelocity = this.state.lastVelocities[noteName];
        }
      } else {
        let lastVelocities = Object.assign({}, this.state.lastVelocities);
        lastVelocities[noteName] = event.velocity;
        this.setState({lastVelocities});
      }

      // I've seen 127 used as a velocity -> gain denominator, too...
      const updatedVolume = noteVelocity/100 * this.state.volumeRatio;
      this.setState({currentNote: event.noteName, currentTick: event.tick});
      //console.log("PLAYING",event.noteName,"VOL",updatedVolume,"DURATION",event.delta);
      this.state.instrument.play(event.noteName, this.state.ac.currentTime, {gain: updatedVolume, duration: event.delta});
      // Do notes have to be stopped explicitly at the end of their duration?
      //note.stop(this.state.ac.currentTime + event.delta)
    } else if (event.name === "Set Tempo") {
      const tempoRatio = 1 + (parseFloat(event.data) - parseFloat(this.state.baseTempo)) / parseFloat(this.state.baseTempo);
      const playbackTempo = parseFloat(this.state.sliderTempo) * tempoRatio;
      
      this.state.samplePlayer.setTempo(playbackTempo);
      this.setState({speedupFactor: tempoRatio});
    }
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
        envelope: {
          attack: 0.02,
          decay: 0.1,
          sustain: 0.3,
          release: 1
        }
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

  render() {

    //const manifestUrl = "https://purl.stanford.edu/dj406yq6980/iiif/manifest";
    const imageUrl = "https://stacks.stanford.edu/image/iiif/dj406yq6980%252Fdj406yq6980_0001/info.json";

    // Would be nice to get a ref to the OpenSeadragon viewer from this
    let iiifViewer = <MultiViewer height="800px" width="300px" iiifUrls={[imageUrl]} showToolbar={false}/>;

    let changePlaybackMethod = e => {
      this.stopSong();
      this.setState({playbackMethod: e.target.id});
    }

    let currentTime = (this.state.ac == null) ? 0 : this.state.ac.currentTime;
    let noteStats = "";
    if (this.state.isPlaying && (this.state.playbackMethod === "sample")) {
      noteStats = "Note being played: " + this.state.currentNote + " at " + currentTime + "s tick " + this.state.currentTick + " (" + (this.state.currentTick / currentTime) + " ticks/s)";
    }

    let tempoSlider = <input type="range" min="0" max="180" value={this.state.sliderTempo} className="slider" id="tempoSlider" onChange={this.updateTempoSlider} />;
    let volumeSlider = <input type="range" min="0" max="2" step=".1" value={this.state.volumeRatio} className="slider" id="tempoSlider" onChange={this.updateVolumeSlider} />;

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
          <div>
            Tempo: {tempoSlider} {this.state.sliderTempo} bpm
          </div>
          <div>
            Volume: {volumeSlider} {this.state.volumeRatio}
          </div>
        </div>
        <p>{noteStats}</p>
        {iiifViewer}
      </div>
    );
  }
}

export default App;
