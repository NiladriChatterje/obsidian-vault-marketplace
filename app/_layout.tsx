import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { AuthProvider } from '../src/store/auth';
import { colors } from '../src/theme';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.background },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="vault/[id]" options={{ title: '' }} />
        <Stack.Screen name="seller/[id]" options={{ title: 'Seller' }} />
        <Stack.Screen name="browse" options={{ title: 'Browse' }} />
        <Stack.Screen name="sell/[id]" options={{ title: 'Listing' }} />
        <Stack.Screen name="sell/payouts" options={{ title: 'Payout details' }} />
        <Stack.Screen name="auth" options={{ presentation: 'modal', headerShown: false }} />
        <Stack.Screen name="checkout-result" options={{ headerShown: false }} />
      </Stack>
    </AuthProvider>
  );
}
