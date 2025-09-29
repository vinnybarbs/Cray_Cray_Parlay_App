import React, { useState, useCallback } from 'react';

// --- Mappings ---
const SPORT_SLUGS = { NFL:'americanfootball_nfl', NBA:'basketball_nba', MLB:'baseball_mlb', NHL:'icehockey_nhl', Soccer:'soccer_epl', NCAAF:'americanfootball_ncaaf', 'PGA/Golf':'golf_pga', Tennis:'tennis_atp'};
const MARKET_MAPPING = { 'Moneyline/Spread':['h2h','spreads'], 'Totals (O/U)':['totals'], 'Player Props':['player_points'], 'Team Props':['team_points'] };
const BOOKMAKER_MAPPING = { DraftKings:'draftkings', FanDuel:'fanduel', MGM:'mgm', Caesars:'caesars', Bet365:'bet365' };
const RISK_LEVEL_DEFINITIONS = { Low:"High probability, heavy favorites", Medium:"Balanced favorites with moderate props", High:"Value underdogs and high-variance outcomes" };
const AI_MODELS = ['OpenAI','Gemini'];

const App = () => {
  // --- UI state ---
  const [selectedSports,setSelectedSports]=useState(['NFL']);
  const [selectedBetTypes,setSelectedBetTypes]=useState(['Moneyline/Spread']);
  const [riskLevel,setRiskLevel]=useState('Low');
  const [numLegs,setNumLegs]=useState(3);
  const [oddsPlatform,setOddsPlatform]=useState('DraftKings');
  const [aiModel,setAiModel]=useState('OpenAI');
  const [loading,setLoading]=useState(false);
  const [results,setResults]=useState('');
  const [error,setError]=useState(null);

  // Toggle handlers
  const toggleSport=(sport)=>setSelectedSports(prev=>prev.includes(sport)?prev.filter(s=>s!==sport):[...prev,sport]);
  const toggleBetType=(betType)=>setSelectedBetTypes(prev=>prev.includes(betType)?prev.filter(b=>b!==betType):[...prev,betType]);

  // Fetch odds
  const fetchOddsData=async()=>{
    try{
      const oddsResults=[];
      const selectedBookmaker=BOOKMAKER_MAPPING[oddsPlatform];
      const apiKey=import.meta.env.VITE_ODDS_API_KEY;

      for(const sport of selectedSports){
        const slug=SPORT_SLUGS[sport];
        const markets=selectedBetTypes.flatMap(bt=>MARKET_MAPPING[bt]).join(',');
        const url=`${import.meta.env.VITE_API}/sports/${slug}/odds/?regions=us&markets=${markets}&oddsFormat=american&bookmakers=${selectedBookmaker}&apiKey=${apiKey}`;
        const res=await fetch(url);
        if(!res.ok) continue;
        const data=await res.json();
        oddsResults.push(...data);
      }

      return oddsResults;
    } catch(e){ console.error('Odds API error:',e); return []; }
  };

  // Generate prompt
  const generatePrompt=useCallback((oddsData)=>{
    const sportsStr=selectedSports.join(', ');
    const betTypesStr=selectedBetTypes.join(', ');
    const oddsContext=oddsData.length?`\n\n**Supplemental Odds Data**:\n${JSON.stringify(oddsData.slice(0,10),null,2)}`:'';
    return `
You are a sports betting analyst.
Generate exactly ${numLegs}-leg parlays, bonus lock included.

Sports: ${sportsStr}
Bet types: ${betTypesStr}
Risk: ${RISK_LEVEL_DEFINITIONS[riskLevel]}
Supplemental odds: ${oddsContext}
`.trim();
  },[selectedSports,selectedBetTypes,numLegs,riskLevel]);

  // Fetch parlay
  const fetchParlaySuggestion=useCallback(async()=>{
    if(loading || selectedSports.length===0 || selectedBetTypes.length===0) return;
    setLoading(true); setResults(''); setError(null);

    try{
      const oddsData=await fetchOddsData();
      const prompt=generatePrompt(oddsData);

      const apiUrl=aiModel==='OpenAI'?'/api/openai':'/api/gemini';
      const response=await fetch(apiUrl,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({prompt})
      });

      if(!response.ok){
        const text=await response.text();
        throw new Error(`AI API error: ${response.status} - ${text}`);
      }

      const data=await response.json();
      const content=data.choices?.[0]?.message?.content || data.output;
      if(!content) throw new Error('No content returned from AI');

      setResults(content);
    } catch(e){
      console.error(e);
      setError(`Failed to generate parlays: ${e.message}`);
    } finally{
      setLoading(false);
    }
  },[aiModel,selectedSports,selectedBetTypes,loading,generatePrompt]);

  // --- UI ---
  const CheckboxGroup=({label,options,selectedOptions,onToggle})=>(
    <div className="flex flex-col space-y-3">
      <label className="text-gray-200 text-sm font-semibold">{label}</label>
      <div className="grid grid-cols-2 gap-2">
        {options.map(opt=>(
          <label key={opt} className="flex items-center space-x-2 cursor-pointer group">
            <input type="checkbox" checked={selectedOptions.includes(opt)} onChange={()=>onToggle(opt)}
              className="w-4 h-4 text-yellow-500 bg-gray-700 border-gray-600 rounded focus:ring-yellow-400 focus:ring-2 cursor-pointer"/>
            <span className="text-sm text-gray-300 group-hover:text-yellow-400 transition">{opt}</span>
          </label>
        ))}
      </div>
    </div>
  );

  const Dropdown=({label,value,onChange,options,description})=>(
    <div className="flex flex-col space-y-2">
      <label className="text-gray-200 text-sm font-semibold">{label}</label>
      <select value={value} onChange={e=>onChange(e.target.value)}
        className="bg-gray-700 text-white p-3 rounded-xl border border-yellow-500 focus:ring-yellow-400 focus:border-yellow-400 transition shadow-lg appearance-none cursor-pointer">
        {options.map(opt=><option key={opt} value={opt}>{opt}</option>)}
      </select>
      {description&&<p className="text-xs text-gray-400 mt-1 italic">{description}</p>}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-900 text-white font-sans p-4">
      {/* Header */}
      <header className="flex flex-col items-center justify-center py-6 mb-6 bg-gray-800 rounded-2xl shadow-2xl">
        <h1 className="text-4xl font-extrabold tracking-tight mt-2 text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-red-500">Cray Cray</h1>
        <p className="text-xl font-medium text-gray-300">for Parlays</p>
      </header>

      {/* Controls */}
      <div
