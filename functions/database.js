const admin = require("firebase-admin");
const spotify = require("./spotify");

require("dotenv").config();

const serviceAccount = require(process.env.SERVICE_ACCOUNT_URL);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://thoomin-spotify-app.firebaseio.com"
});

const db = admin.database();

function getIdToken(email, password) {
  return new Promise((resolve, reject) => {
    firebase
      .auth()
      .signInWithEmailAndPassword(email, password)
      .then(blah => {
        return firebase.auth().currentUser.getIdToken(true);
      })
      .then(idToken => {
		console.log(idToken);
		resolve(idToken);
        return idToken;
      })
      .catch(error => {
		console.log(error);
		reject(error);
      });
  });
}

function createFirebaseToken(spotifyUID) {
  return new Promise((resolve, reject) => {
    admin
      .auth()
      .createCustomToken(spotifyUID)
      .then(customToken => {
        resolve(customToken);
        console.log("Custom Token: " + customToken);
        return customToken;
      })
      .catch(error => {
        console.log(error);
        reject(new Error("Unable to create firebase token."));
      });
  });
}

function createThoominUser(spotifyUser, user) {
  return new Promise((resolve, reject) => {
    if (user) {
      resolve(user);
    } else {
      admin
        .auth()
        .createUser({
          uid: spotifyUser.uri,
          displayName: spotifyUser.name,
          email: spotifyUser.email,
          emailVerified: false
          // Correctly handle photoURL (has to be a URL).
          // photoURL: spotifyUser.image
        })
        .then(user => {
          resolve(user);
          return user;
        })
        .catch(error => {
          console.log(error);
          reject(new Error("Unable to create spotify user."));
        });
    }
  });
}

function updateSpotifyUser(spotifyUser) {
  return new Promise((resolve, reject) => {
    admin
      .auth()
      .getUser(spotifyUser.uri)
      .then(user => {
        return admin.auth().updateUser(spotifyUser.uri, {
          displayName: spotifyUser.name,
          email: spotifyUser.email,
          emailVerified: false
          // Correctly handle photoURL (has to be a URL).
          // photoURL: spotifyUser.image
        });
      })
      .then(user => {
        resolve(user);
        return user;
      })
      .catch(error => {
        if (error.code === "auth/user-not-found") {
          resolve(false);
        } else {
          console.log(error);
          reject(new Error("Couldn't update spotify user account."));
        }
      });
  });
}

function saveRefreshToken(thoominUID, refreshToken) {
  return new Promise((resolve, reject) => {
    db.ref("/users/" + thoominUID + "/tokens")
      .set({
        refreshToken: refreshToken
      })
      .then(thing => {
        resolve(thing);
        return thing;
      })
      .catch(error => {
        console.log(error);
        reject(new Error("Unable to save tokens to database."));
      });
  });
}

function loginThoominUser(spotifyUser, refreshToken) {
  let thoominToken = null;

  return new Promise((resolve, reject) => {
    createFirebaseToken(spotifyUser.uri)
      .then(customToken => {
        thoominToken = customToken;
        return updateSpotifyUser(spotifyUser);
      })
      .then(user => {
        return createThoominUser(spotifyUser, user);
      })
      .then(user => {
        return saveRefreshToken(spotifyUser.uri, refreshToken);
      })
      .then(token => {
        resolve(thoominToken);
        return token;
      })
      .catch(error => {
        reject(error);
      });
  });
}

function getRefreshToken(idToken) {
  return new Promise((resolve, reject) => {
    admin
      .auth()
      .verifyIdToken(idToken)
      .then(decodedToken => {
        return db.ref("/users/" + decodedToken.uid + "/tokens").once("value");
      })
      .then(info => {
        resolve(info.toJSON().refreshToken);
        return info.toJSON().refreshToken;
      })
      .catch(error => {
        reject(error);
      });
  });
}

function createParty(idToken, partyName) {
  return new Promise((resolve, reject) => {
    let userRecord = null;
    let playlistId = null;

    admin
      .auth()
      .verifyIdToken(idToken)
      .then(decodedToken => {
        return admin.auth().getUser(decodedToken.uid);
      })
      .then(user => {
        if (!partyName) {
          partyName = user.toJSON().displayName + "'s Party";
        }

        userRecord = user;
        return getRefreshToken(idToken);
      })
      .then(refreshToken => {
        return spotify.getAccessTokenFromRefreshToken(refreshToken);
      })
      .then(accessToken => {
        return spotify.createPlaylist(accessToken, partyName);
      })
      .then(playlist => {
        playlistId = playlist.id;

        return addPartyCodeToDatabase(userRecord.uid, playlist);
      })
      .then(party => {
        resolve({ playlistId: playlistId, partyCode: party });
        return party;
      })
      .catch(error => {
        reject(new Error("Error creating a party."));
      });
  });
}

function addPartyCodeToDatabase(thoominUID, playlist) {
  return new Promise((resolve, reject) => {
    const partyCode = getRandomPartyId(6);

    // TODO: Check partyCode for duplicates

    db.ref("users/" + thoominUID + "/party")
      .set({
        partyCode: partyCode
      })
      .then(info => {
        return db.ref("party/" + partyCode).set({
          currentlyPlaying: "",
          users: {},
          hostUID: thoominUID,
          name: playlist.name,
          id: playlist.id
        });
      })
      .then(thing => {
        resolve({ partyCode: partyCode });
        return thing;
      })
      .catch(error => {
        reject(error);
      });
  });
}

function getRandomPartyId(length) {
  const possibleCharacters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890";
  let partyCode = "";

  for (let i = 0; i < length; i++) {
    partyCode += possibleCharacters.charAt(
      Math.floor(Math.random() * possibleCharacters.length)
    );
  }

  return partyCode;
}

function addTrackToParty(partyCode, name, trackId) {
  let uid = null;
  let playlistId = null;

  return new Promise((resolve, reject) => {
    db.ref("/party/" + partyCode)
      .once("value")
      .then(info => {
        uid = info.toJSON().hostUID;
        playlistId = info.toJSON().id;

        console.log("PARTY: ", info.toJSON());
        return db.ref("/users/" + uid + "/tokens").once("value");
      })
      .then(tokens => {
        const refreshToken = tokens.toJSON().refreshToken;
        console.log("Refresh Token: " + refreshToken);
        return spotify.getAccessTokenFromRefreshToken(refreshToken);
      })
      .then(accessToken => {
        console.log("accessToken: " + accessToken);
        return spotify.addTrackToPlaylist(accessToken, trackId, playlistId);
      })
      .then(playlist => {
        console.log("playlist: " + playlist);
        resolve(playlist);
        return playlist;
      })
      .catch(error => {
        reject(error);
      });
  });
}

function getCurrentlyPlaying(partyCode, name) {
  let uid = null;
  let playlistId = null;

  return new Promise((resolve, reject) => {
    db.ref("/party/" + partyCode)
      .once("value")
      .then(info => {
        if (!info.exists()) {
          reject(new Error("Party does not exist"));
        }

        uid = info.toJSON().hostUID;
        playlistId = info.toJSON().id;

        console.log("PARTY: ", info.toJSON());
        return db.ref("/users/" + uid + "/tokens").once("value");
      })
      .then(tokens => {
        const refreshToken = tokens.toJSON().refreshToken;
        console.log("Refresh Token: " + refreshToken);
        return spotify.getAccessTokenFromRefreshToken(refreshToken);
      })
      .then(accessToken => {
        console.log("accessToken: " + accessToken);
        return spotify.getCurrentlyPlaying(accessToken);
      })
      .then(body => {
        console.log(body);
        resolve(body);
        return body;
      })
      .catch(error => {
        reject(error);
      });
  });
}

function getQueue(partyCode, name) {
  let uid = null;
  let playlistId = null;
  let tracks = null;

  return new Promise((resolve, reject) => {
    db.ref("/party/" + partyCode)
      .once("value")
      .then(info => {
        if (!info.exists()) {
          reject(new Error("Party does not exist"));
        }

        uid = info.toJSON().hostUID;
        playlistId = info.toJSON().id;

        console.log("PARTY: ", info.toJSON());
        return db.ref("/users/" + uid + "/tokens").once("value");
      })
      .then(tokens => {
        const refreshToken = tokens.toJSON().refreshToken;
        console.log("Refresh Token: " + refreshToken);
        return spotify.getAccessTokenFromRefreshToken(refreshToken);
      })
      .then(accessToken => {
        console.log("accessToken: " + accessToken);
        return spotify.getPlaylistSongs(accessToken, playlistId);
      })
      .then(trackss => {
        tracks = trackss;
        return getCurrentlyPlaying(partyCode, name);
      })
      .then(currentlyPlaying => {
        for (let i = 0; i < tracks.length; i++) {
          if (tracks[i].id === currentlyPlaying.id) {
            tracks = tracks.slice(i, tracks.length);
          }
        }

        resolve(tracks);

        return tracks;
      })
      .catch(error => {
        reject(error);
      });
  });
}

function removeTrack(idToken, partyCode, trackId) {
  let accessToken = null;

  return new Promise((resolve, reject) => {
    getRefreshToken(idToken)
      .then(refreshToken => {
        return spotify.getAccessTokenFromRefreshToken(refreshToken);
      })
      .then(accesssToken => {
        accessToken = accesssToken;

        return db.ref("/party/" + partyCode).once("value");
      })
      .then(info => {
        console.log("PARTY: ", info.toJSON());
        playlistId = info.toJSON().id;

        return spotify.deleteSongFromPlaylist(accessToken, playlistId, trackId);
      })
      .then(thing => {
        resolve(thing);
        return thing;
      })
      .catch(error => {
        console.log(error);
        reject(error);
      });
  });
}

function joinParty(name, partyCode) {
  return new Promise((resolve, reject) => {
    db.ref("/party/" + partyCode)
      .once("value")
      .then(info => {
        if (info.exists()) {
          resolve("Joined party!");
        } else {
          reject(new Error("Party does not exist."));
        }

        return;
      })
      .catch(error => {
        resolve(new Error("Party does not exist."));
      });
  });
}

module.exports = {
  createFirebaseToken: function(spotifyURI) {
    return createFirebaseToken(spotifyURI);
  },
  getRandomPartyId: function(length) {
    return getRandomPartyId(length);
  },
  addPartyCodeToDatabase: function(thoominUID) {
    return addPartyCodeToDatabase(thoominUID);
  },
  loginThoominUser: function(spotifyUser, refreshToken) {
    return loginThoominUser(spotifyUser, refreshToken);
  },
  getRefreshToken: function(idToken) {
    return getRefreshToken(idToken);
  },
  createParty: function(idToken, partyName) {
    return createParty(idToken, partyName);
  },
  addTrackToParty: function(partyCode, name, trackId) {
    return addTrackToParty(partyCode, name, trackId);
  },
  joinParty: function(name, partyCode) {
    return joinParty(name, partyCode);
  },
  getCurrentlyPlaying: function(partyCode, name) {
    return getCurrentlyPlaying(partyCode, name);
  },
  getQueue: function(partyCode, name) {
    return getQueue(partyCode, name);
  },
  removeTrack: function(idToken, partyCode, trackId) {
    return removeTrack(idToken, partyCode, trackId);
  },
  getIdToken: function(email, password) {
    return getIdToken(email, password);
  }
};

// getIdToken(email, password) 
