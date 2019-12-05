const functions = require('firebase-functions');
const firebase = require("firebase");
const express = require('express');
const querystring = require('querystring');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const spotify = require('./spotify');
const database = require('./database');

require('dotenv').config();

firebase.initializeApp({
	apiKey: process.env.WEB_API_KEY,
	databaseURL: process.env.DATABASE_URL
});

const app = express();

const basePath = '/api';
const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const REDIRECT_URI = process.env.SPOTIFY_REDIRECT_URI;
const VERSION = "0.0.6";
const stateKey = '__session';

app.use(cors());
app.use(cookieParser());


function generateRandomString(length) {
	let output = '';
	let possibleCharacters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

	for(let i = 0; i < length; i++) {
		output += possibleCharacters.charAt(Math.floor(Math.random() * possibleCharacters.length));
	}

	return output;
}

app.get(basePath + '/url', (req, res) => {
	const fullUrl = req.protocol + '://' + req.get('host') + req.baseUrl;
	res.send(fullUrl);
});

app.get(basePath + '/version', (req, res) => {
	res.status(200).json({version: VERSION});
});

app.get(basePath + '/swaggerhub', (req, res) => {
	const url = 'https://app.swaggerhub.com/apis/ntorressm/Thoomin-Spotify/1.0.0';
	res.redirect(url);
});

app.get(basePath + '/spotify/auth', (req, res) => {
  spotify.getAccessToken()
  .then(accessToken => {
	res.status(200).json({accessToken: accessToken});
	return accessToken;
  })
  .catch(error => {
	res.status(400).json({error: error.message});
  });
});

app.post(basePath + '/spotify/tracks', (req, res) => {
	const trackIds = req.body.trackIds;

	if (!trackIds) {
		res.status(400).json({error: "Missing trackIds."});
	} else {
		spotify.getTracksByIds(trackIds)
		.then(tracks => {
			res.status(200).json(tracks);
			return tracks;
		})
		.catch(error => {
			res.status(400).json({error: error});
		}) 
	}
});

app.post(basePath + '/login', (req, res) => {
	const email = req.body.email;
	const password = req.body.password;

	database.getIdToken(email, password)
	.then(thing => {
		res.send(thing);
	})
	.catch(error => {
		res.send(error);
	})
});

app.post(basePath + '/spotify/track', (req, res) => {
  const trackId = req.body.trackId;

  if (!trackId) {
	res.status(400).json({error: "Missing trackId."});
  } else {
	spotify.getTrackByIdOld(trackId)
	.then(trackInfo => {
	  res.status(200).json(trackInfo);
	  return trackInfo;
	})
	.catch(error => {
	  res.status(400).json({error: error.message});
	})
  }
});

app.get(basePath + '/user/login', (req, res) => {
	const state = generateRandomString(16);
	res.cookie(stateKey, state);

	// const redirectURI = req.protocol + '://' + req.get('host') + req.baseUrl + '/api/user/callback';
	const redirectURI = 'https://thoominspotify.com/api/user/callback';
	console.log("REDIRECT URI " + redirectURI);
	spotify.setRedirectURI(redirectURI);

	const scope = 'user-read-private user-read-email streaming playlist-modify-public playlist-modify-private user-read-currently-playing user-read-playback-state';
	res.redirect('https://accounts.spotify.com/authorize?' +
		querystring.stringify({
		response_type: 'code',
		client_id: CLIENT_ID,
		scope: scope,
		redirect_uri: redirectURI,
		state: state
	}));
});

app.get(basePath + '/user/callback', (req, res) => {
	const code = req.query.code;
	const state = req.query.state;
	const storedState = req.cookies ? req.cookies[stateKey] : null;

	if (state === null || state !== storedState) {
		// const url = req.protocol + '://' + req.get('host') + '/?';
		const url = 'https://thoominspotify.com/?';
		
		res.redirect(url + 
			querystring.stringify({
				error: 'state_mismatch'
			})
		);
	} else {
		let refreshToken = null;
		let accessToken = null;

		spotify.getTokensFromCode(code)
		.then((tokens) => {
			refreshToken = tokens.refreshToken;
			accessToken = tokens.accessToken;
			console.log("refresh token " + refreshToken);
			console.log("access token " + accessToken);
			
			return spotify.getSpotifyUser(accessToken);
		})
		.then(spotifyUser => {
			console.log("SpotifyUser: ", spotifyUser);
			return database.loginThoominUser(spotifyUser, refreshToken);
		})
		.then(thoominToken => {
			const url = process.env.SITE_URL + '/home';

			res.cookie('thoominToken', thoominToken);
			res.redirect(url);
			return thoominToken;
		})
		.catch(error => {
			res.status(400).json({error : error.message});
		});
	}
});

app.post(basePath + '/party/add', (req, res) => {
	const name =  req.body.name || 'Guest';
	const trackId = req.body.trackId;
	const partyCode = req.body.partyCode;

	if (!trackId) {
		res.status(400).json({error: "trackId required to add track to party."});
	} else if (!partyCode) {
		res.status(400).json({error: "partyCode required to add track to party."});
	} else {
		database.addTrackToParty(partyCode, name, trackId).then(playlist => {
			res.status(200).json({playlist: playlist});
			return playlist;
		})
		.catch(error => {
			res.status(400).json({error: error});
		});
	}
});

app.post(basePath + '/user/party/remove', (req, res) => {
	const idToken = req.body.idToken;
	const partyCode = req.body.partyCode;
	const trackId = req.body.trackId;
	
	if (!idToken) {
		res.status(400).json({error: "idToken required to delete track."});
	} else if (!partyCode) {
		res.status(400).json({error: "partyCode required to delete track."});
	} else if (!trackId) {
		res.status(400).json({error: "trackId required to delete track."});
	} else {
		database.removeTrack(idToken, partyCode, trackId)
		.then(thing => {
			res.status(200).json(thing);
			return thing;
		})
		.catch(error => {
			res.status(400).json({error: error.message});
		})
	}
});

app.post(basePath + '/party/queue', (req, res) => {
	const name =  req.body.name || 'Guest';
	const partyCode = req.body.partyCode;

	if (!partyCode) {
		res.status(400).json({error: "partyCode required to get queue."});
	} else {
		database.getQueue(partyCode, name).then(tracks => {
			res.status(200).json(tracks);
			return track;
		})
		.catch(error => {
			res.status(400).json({error: error.message});
		});
	}
});

app.post(basePath + '/party/join', (req, res) => {
	const name =  req.body.name || 'Guest';
	const partyCode = req.body.partyCode;

	if (!partyCode) {
		res.status(400).json({error: "partyCode required."});
	} else {
		database.joinParty(name, partyCode)
		.then(info => {
			res.status(200).json(info);
			return;
		})
		.catch(error => {
			res.status(400).json({error : error.message});
		})
	}
});

app.post(basePath + '/user/party/create', (req, res) => {
	const idToken = req.body.idToken;
	const partyName = req.body.partyName || null;

	if (!idToken) {
		res.status(400).json({error: "idToken required to retrieve accessToken."});
	} else {
		database.createParty(idToken, partyName)
		.then(party => {
			res.status(200).json(party);
			return party;
		})
		.catch(error => {
			console.log(error);
			res.status(400).json({error: error.message});
		})
	}
});

app.post(basePath + '/party/playing', (req, res) => {
	const name =  req.body.name || 'Guest';
	const partyCode = req.body.partyCode;

	if (!partyCode) {
		res.status(400).json({error: "partyCode required to add track to party."});
	} else {
		database.getCurrentlyPlaying(partyCode, name).then(track => {
			res.status(200).json(track);
			return track;
		})
		.catch(error => {
			res.status(400).json({error: error.message});
		});
	}
});

app.post(basePath + '/user/accessToken', (req, res) => {
	const idToken = req.body.idToken;

	if (!idToken) {
		res.status(400).json({error: "idToken required to retrieve accessToken."});
	} else {
		database.getRefreshToken(idToken)
		.then(refreshToken => {
			return spotify.getAccessTokenFromRefreshToken(refreshToken);
		})
		.then(accessToken => {
			res.status(200).json({accessToken : accessToken});
			return accessToken;
		})
		.catch(error => {
			console.log(error);
			res.status(400).json({error: error.message});
		})
	}
});


exports.app = functions.https.onRequest(app);