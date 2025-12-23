export class BackgroundMusic {
    constructor() {
        this.tracks = [
            '/minecraftmusic.mp3',
            '/Elevator Music.mp3',
            '/Mii Editor - Mii Maker (Wii U) Music [ ezmp3.cc ].mp3',
            '/Raise_A_Floppa_Soundtrack_[_YouConvert.net_].mp3',
            '/Wii-Shop-Background-Music.mp3'
        ];
        this.currentIndex = Math.floor(Math.random() * this.tracks.length);
        this.audio = new Audio();
        this.audio.loop = false;
        this.audio.volume = 0.3;
        this.audio.preload = 'auto';
        this.active = false;

        this.audio.addEventListener('ended', () => {
            this.nextTrack();
        });
    }

    start() {
        if (this.active && !this.audio.paused) return;
        this.playTrack();
    }

    playTrack() {
        // Use encodeURI to handle spaces and brackets in filenames like "Mii Editor [...]"
        const trackPath = this.tracks[this.currentIndex];
        this.audio.src = encodeURI(trackPath);
        
        const playPromise = this.audio.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                this.active = true;
            }).catch(error => {
                console.warn("BackgroundMusic playback blocked by browser. Awaiting user interaction.", error);
                this.active = false;
            });
        }
    }

    nextTrack() {
        this.currentIndex = (this.currentIndex + 1) % this.tracks.length;
        this.playTrack();
    }

    setVolume(v) {
        this.audio.volume = v;
    }
}

