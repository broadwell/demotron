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
      ac: null,
      currentTick: 0,
      playbackMethod: "sample",
      midi: null,
    }

    this.midiEvent = this.midiEvent.bind(this);
    this.playSong = this.playSong.bind(this);
    this.stopSong = this.stopSong.bind(this);
    this.instrument = this.instrument.bind(this);
    this.dataURItoBlob = this.dataURItoBlob.bind(this);
    this.getMidi = this.getMidi.bind(this);
    this.loadMidi = this.loadMidi.bind(this);
    this.processMidi = this.processMidi.bind(this);
  }

  componentDidMount() {

    /* Load MIDI data as JSON {"songname": "base64midi"} */
    let mididata = require("./mididata.json");
    this.setState({currentSong: mididata['magic_fire']});

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

  midiEvent(event) {
    // Do something when a MIDI event is fired.
    // (this is the same as passing a function to MidiPlayer.Player() when instantiating.
    if (event.name === 'Note on') {
      //console.log("NOTE ON EVENT AT", this.state.ac.currentTime, event.tick);
      this.setState({currentNote: event.noteName, currentTick: event.tick});
      this.state.instrument.play(event.noteName, this.state.ac.currentTime, event.delta, {gain: event.velocity/100, duration: event});
      // Do notes have to be stopped explicitly at the end of their duration?
      //note.stop(this.state.ac.currentTime + event.delta)
    }

  }

  playSong() {

    if (this.state.isPlaying) { return; }

    let AudioContext = window.AudioContext || window.webkitAudioContext || false; 
    let ac = new AudioContext();

    this.setState({ac: ac, isPlaying: true});

    if (this.state.playbackMethod === "sample") {
      Soundfont.instrument(ac, 'acoustic_grand_piano', { soundfont: 'FluidR3_GM' }).then(this.instrument);
    } else {
      this.loadMidi(this.dataURItoBlob(this.state.currentSong))
        .then(midiData => this.processMidi(midiData));
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

  /* SAMPLE-BASED PLAYBACK USING midi-player-js AND soundfont-player */

  instrument(inst) {

    /* Instantiate the MIDI player */
    let Player = new MidiPlayer.Player(function(event) {
      //console.log("MIDI EVENT");
    });

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

    /* Load MIDI data and start the player */
    Player.loadDataUri(this.state.currentSong);
    Player.play();

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

  processMidi(midi) {

    this.setState({midi});
  
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
      noteStats = "Note being played: " + this.state.currentNote + " at " + currentTime + "s tick " + this.state.currentTick + "(" + (this.state.currentTick / currentTime) + "ticks/s)";
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
        </div>
        <p>{noteStats}</p>
        {iiifViewer}
      </div>
    );
  }
}

export default App;
