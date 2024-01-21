import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform, PermissionsAndroid, TouchableOpacity, Image} from 'react-native';
import BackgroundFetch from "react-native-background-fetch";
import Geolocation, { stopObserving } from 'react-native-geolocation-service';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import SoundLevel from 'react-native-sound-level';
import logo from './assets/logo.png';

import { BACKEND_URL } from "@env";

console.log(BACKEND_URL);

const App = () => {
  const updateInterval = 4800; // Update every 60 seconds
  const [showSuccessMessage, setShowSuccessMessage] = useState(false);
  const [noiseData, setNoiseData] = useState(0);
  const [location, setLocation] = useState({ lat: 0, long: 0, timestamp: 0 });


  let intervalId = null;
  useEffect(() => {
    askForPermissions();
    // Start location tracking

    return () => {
      if(intervalId != null) {
        clearInterval(intervalId);
      }
    };
  }, []);

  const askForPermissions = async () => {
    let microphonePermission;
    let locationPermission;
    if (Platform.OS === 'ios') {
      microphonePermission = await request(PERMISSIONS.IOS.MICROPHONE);
      locationPermission = await check(PERMISSIONS.IOS.LOCATION_WHEN_IN_USE);
    } else {
      microphonePermission = await request(PERMISSIONS.ANDROID.RECORD_AUDIO);
      locationPermission = await request(PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION);
    }

    if (microphonePermission === RESULTS.GRANTED && locationPermission === RESULTS.GRANTED) {
      if(intervalId != null) {
        clearImmediate(intervalId);
      }
      // collect data in the foreground:
      intervalId = setInterval(async () => {
        console.log('Fetching data');
        await fetchData();
      }, updateInterval);

      // collect data in the background:
      initBackgroundFetch();
    } else {
      console.log('Permission denied');
    }
  }

  const initBackgroundFetch = async () => {
    console.log('Initializing background fetch')
    BackgroundFetch.configure({
      minimumFetchInterval: 15, // <-- minutes (15 is minimum allowed)
      stopOnTerminate: false,
      startOnBoot: true,
    }, async () => {
      console.log("[js] Received background-fetch event");
      
      
      const noiseLevel = await fetchNoiseLevel();
      const locationData = await fetchLocation();
      const noiseData = {
        ...locationData,
        noise: noiseLevel,
      };

      console.log("[Background fetch] data:", noiseData);
      await sendDataToBackend(noiseData);
      console.log("[Background fetch] successfully sent the data");
      
      // Required: Signal to native code that the task is complete.
      BackgroundFetch.finish(BackgroundFetch.FETCH_RESULT_NEW_DATA);
    }, (error) => {
      console.log("[js] RNBackgroundFetch failed to start");
    });

    BackgroundFetch.status((status) => {
      if (status === BackgroundFetch.STATUS_RESTRICTED) {
        console.log("BackgroundFetch restricted");
      } else if (status === BackgroundFetch.STATUS_DENIED) {
        console.log("BackgroundFetch denied");
      } else if (status === BackgroundFetch.STATUS_AVAILABLE) {
        console.log("BackgroundFetch is enabled");
      }
    });
    
  };

  const fetchLocation = () => {
    return new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (position) => {
          const lat = position.coords.latitude;
          const long = position.coords.longitude;
          resolve({
            lat: lat,
            long: long,
            timestamp: new Date().toISOString()
          });
        },
        (error) => {
          console.error(error);
          reject(error);
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5, forceRequestLocation: true }
      );
    });
  };

  const fetchNoiseLevel = () => {
    return new Promise((resolve) => {
      const noiseLevels= [];
      SoundLevel.start(20); // interval 250ms
      let cnt = 0;
      const numRecords = 40;
      let noiseLevel = 0;
      SoundLevel.onNewFrame = (noiseData) => {
        console.log("noise level", noiseData);
        // skip first 2 values as they are always 0
        if(cnt > 1) {
          noiseLevels.push(noiseData.rawValue);
        }
        ++cnt;
        if(cnt >= numRecords) {
          SoundLevel.stop();

          const rms = noiseLevels.reduce((acc, val) => acc + val * val, 0) / noiseLevels.length;
          const decibels = 20 * Math.log10(Math.sqrt(rms));
          console.log("recorded", cnt, "values")
          resolve(decibels);
        }
      };
    });
  };


  const sendDataToBackend = async (noiseData) => {
    try {
      const response = await fetch(`${BACKEND_URL}/collect-noise-data`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(noiseData),
      });
      if (response.ok) {
        console.log('Data sent successfully');
      } else {
        console.log('Failed to send data');
      }
    } catch (error) {
      console.error('Error:', error);
      // console.log(error.message)
      console.error(error.message);
      console.error(error.stack);
    }
  };


  const fetchData = async () => {
    try {
      const locationDataPromise = fetchLocation();
      const noiseLevelPromise = fetchNoiseLevel();

      
      const noiseLevel = await noiseLevelPromise;
      
      setNoiseData(noiseLevel);
      const locationData = await locationDataPromise;
      setLocation(locationData);

      console.log('Location data:', locationData);
      console.log('Noise level:', noiseLevel);
    } catch (error) {
      console.log('Error fetching data:', error);
    }
  }

  const handleShareNoiseLevel = async () => {
    try {
      
      const data = {...location, noise: noiseData};
      await sendDataToBackend(data);
      console.log("Shared noise data", data);
      setShowSuccessMessage(true);
      setTimeout(() => setShowSuccessMessage(false), 3000);
    } catch (error) {
      console.error('Error sharing noise data:', error);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image source={logo} style={styles.logo} />
        <Text style={styles.appTitle}>HushHarmony</Text>
      </View>

      <Text style={styles.text}>Latitude: {location.lat}</Text>
      <Text style={styles.text}>Longitude: {location.long}</Text>
      <Text style={styles.text}>Noise Level: {noiseData.toFixed(2)} dB</Text>
      <Text style={styles.text}>Timestamp: {location.timestamp}</Text>

      <TouchableOpacity style={styles.button} onPress={handleShareNoiseLevel}>
      <Text style={styles.buttonText}>Share current noise level</Text>
      </TouchableOpacity>
      {showSuccessMessage && <Text style={styles.successMessage}>Thanks for the update!</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#213741', // Very dark desaturated blue background
    padding: 20,
  },
  header: {
    paddingTop: 0, // Adjust the padding as needed
    paddingBottom: 100, // Adjust the padding as needed
    alignItems: 'center', // Center the logo and title
  },
  logo: {
    width: 100, // Set the width of your logo
    height: 100, // Set the height of your logo
    resizeMode: 'contain', // Ensure the logo is scaled properly
  },
  appTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fae6ce', // You can adjust the color to match your theme
    marginTop: 10, // Space between logo and title
  },
  text: {
    fontSize: 18,
    marginBottom: 10,
    color: '#fae6ce', // Very pale (mostly white) orange text color for contrast
  },
  successMessage: {
    marginTop: 10,
    color: '#aab5b0', // Light grayish cyan for the success message
    fontSize: 16,
  },
  button: {
    backgroundColor: '#495f67', // Dark slate-grayish color for the button
    color: '#fae6ce', // Use the pale orange for button text for contrast
    padding: 10,
    marginTop: 20,
  },
  buttonText: {
    color: '#fae6ce', // Very pale (mostly white) orange text color for contrast
  }
});


export default App;
