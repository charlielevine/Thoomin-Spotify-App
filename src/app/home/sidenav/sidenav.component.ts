import { Component, OnInit } from '@angular/core';
import { SpotifyService } from 'src/app/services/spotify.service';

@Component({
  selector: 'app-sidenav',
  templateUrl: './sidenav.component.html',
  styleUrls: ['./sidenav.component.scss']
})
export class SidenavComponent implements OnInit {
  menuItems = [
    {
      name: 'Dashboard',
      route: 'dashboard'
    },
    {
      name: 'Now Playing',
      route: 'now-playing'
    },
    {
      name: 'Queue',
      route: 'queue'
    }
    // {
    //   name: 'Settings',
    //   route: 'settings'
    // }
  ];
  playlistItems: any[];

  constructor(private spotifyService: SpotifyService) {}

  ngOnInit() {
    this.spotifyService.$playlists.subscribe((playlists) => {
      this.playlistItems = playlists;
    });
  }
}
