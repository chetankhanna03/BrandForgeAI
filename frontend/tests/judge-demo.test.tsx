import React from 'react';
import {render,screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {afterEach,expect,it,vi} from 'vitest';
import JudgeDemoControls from '../app/judge-demo-controls';

afterEach(()=>vi.unstubAllGlobals());
it('reports actual text connectivity separately from media compliance',async()=>{
  const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({status:'ready',message:'Text connectivity only; check media separately.'})});vi.stubGlobal('fetch',fetch);
  render(<JudgeDemoControls brandId="test-brand" busy={false} filename="volt-approved.png" onLoad={vi.fn()}/>);
  expect(fetch).not.toHaveBeenCalled();await userEvent.click(screen.getByRole('button',{name:'Check Nemotron connection'}));
  expect(await screen.findByRole('status')).toHaveTextContent('Text connection verified');
  expect(screen.getByRole('status')).toHaveTextContent('check media separately');
  expect(fetch).toHaveBeenCalledWith('/api/ai/check',expect.objectContaining({method:'POST',headers:{'X-Brand-ID':'test-brand'}}));
});
it('shows rejected credentials as not ready and allows a retry',async()=>{
  const fetch=vi.fn().mockResolvedValueOnce({ok:true,json:async()=>({status:'failed',message:'NVIDIA rejected the configured API key. Update backend/.env.'})}).mockResolvedValueOnce({ok:true,json:async()=>({status:'ready',message:'Text request worked.'})});vi.stubGlobal('fetch',fetch);
  render(<JudgeDemoControls brandId="test-brand" busy={false} onLoad={vi.fn()}/>);
  await userEvent.click(screen.getByRole('button',{name:'Check Nemotron connection'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Nemotron is not ready');expect(screen.getByRole('alert')).toHaveTextContent('backend/.env');
  await userEvent.click(screen.getByRole('button',{name:'Check Nemotron connection'}));expect(await screen.findByRole('status')).toHaveTextContent('Text connection verified');
});
it('lets the judge switch between the two actual sample inputs',async()=>{
  const load=vi.fn();render(<JudgeDemoControls brandId="test-brand" busy={false} filename="volt-violations.png" onLoad={load}/>);
  expect(screen.getByText('Sample B · Four deliberate differences')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button',{name:'Load approved poster'}));expect(load).toHaveBeenLastCalledWith('approved');
  await userEvent.click(screen.getByRole('button',{name:'Load poster with issues'}));expect(load).toHaveBeenLastCalledWith('violations');
});
