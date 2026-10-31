package com.ridewave.app

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.ridewave.app.audio.RideWaveAudioModule
import com.ridewave.app.nearby.RideWaveNearbyModule

/** RideWave's own native modules (loaded through the new-architecture interop layer). */
class RideWavePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
        listOf(RideWaveNearbyModule(reactContext), RideWaveAudioModule(reactContext))

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> = emptyList()
}
