import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Platform, PermissionsAndroid } from 'react-native';
import BackgroundFetch from "react-native-background-fetch";
import Geolocation from 'react-native-geolocation-service';
import { check, request, PERMISSIONS, RESULTS } from 'react-native-permissions';
import SoundLevel from 'react-native-sound-level';

import { BACKEND_URL } from "@env";

console.log(BACKEND_URL);

const App = () => {
  const [data, setData] = useState({ lat: 0, long: 0, noise: 0, timestamp: 0 });
  const updateInterval = 12000; // Update every 60 seconds

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

  const onLocationFetch = () => {
    console.log('Location fetched');
    Geolocation.getCurrentPosition(
      (position) => {
        console.log(position);
        // Process the location here
      },
      (error) => {
        console.log(error);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  const initBackgroundFetch = async () => {
    console.log('Initializing background fetch')
    BackgroundFetch.configure({
      minimumFetchInterval: 15, // <-- minutes (15 is minimum allowed)
      stopOnTerminate: false,
      startOnBoot: true,
    }, () => {
      console.log("[js] Received background-fetch event");
      onLocationFetch();
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
          resolve({
            lat: position.coords.latitude,
            long: position.coords.longitude,
            timestamp: new Date().toISOString()
          });
        },
        (error) => {
          console.error(error);
          reject(error);
        },
        { enableHighAccuracy: true }
      );
    });
  };

  const fetchNoiseLevel = () => {
    return new Promise((resolve) => {
      SoundLevel.start(20); // interval 250ms
      let cnt = 0;
      const numRecords = 100;
      let noiseLevel = 0;
      const noiseLevelNormilizer = 160;
      SoundLevel.onNewFrame = (noiseData) => {
        console.log("noise level", noiseData);
        // skip first 2 values for calibrating
        if(cnt > 1) {
          noiseLevel += noiseData.value;
        }
        ++cnt;
        if(cnt >= numRecords) {
          SoundLevel.stop();
          console.log("recorded", cnt, "values")
          resolve(Math.ceil(noiseLevel/(cnt-2) + noiseLevelNormilizer));
        }
      };
    });
  };


  const sendDataToMongoDB = async (noiseData) => {
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
      const locationData = await fetchLocation();
      const noiseLevel = await fetchNoiseLevel();

      console.log('Location data:', locationData);
      console.log('Noise level:', noiseLevel);
      setData({
        ...locationData,
        noise: noiseLevel,
      })

      const dto = {
        ...locationData,
        noise: noiseLevel,
      }
      await sendDataToMongoDB(dto);
      console.log("Data sent to MongoDB", dto);
    } catch (error) {
      console.log('Error fetching data:', error);
    }
  };


  return (
    <View style={styles.container}>
      <Text style={styles.text}>Latitude: {data.lat}</Text>
      <Text style={styles.text}>Longitude: {data.long}</Text>
      <Text style={styles.text}>Noise Level: {data.noise} dB</Text>
      <Text style={styles.text}>Timestamp: {data.timestamp}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5', // Light grey background
    padding: 20,
  },
  text: {
    fontSize: 18,
    marginBottom: 10,
    color: '#333', // Dark grey text color
  },
});

export default App;
