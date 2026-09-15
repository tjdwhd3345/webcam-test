import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ['src/asis/hook/useCameraStream.ts'],
    rules: {
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['src/asis/lib/camera_utils.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['src/tobe/domain/camera/prepare_idcard_camera_stream.ts'],
    rules: {
      'no-useless-assignment': 'off',
    },
  },
  {
    files: ['src/tobe/lib/hook/useIdcardCameraStream.ts'],
    rules: {
      'react-hooks/refs': 'off',
    },
  },
])
