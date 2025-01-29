import { useState } from 'react'
import './App.css'
import VolumControllApp from './Components/VolumControllApp/VolumControllApp'

function App() {
  const [count, setCount] = useState(0)

  return (
    <>
      {/* <VoiceRecognitionApp /> */}
      <VolumControllApp />
    </>
  )
}

export default App
