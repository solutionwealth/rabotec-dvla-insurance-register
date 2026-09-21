import Fleet from './fleet';
import StaffLogin from './staff-login';
import {headers} from 'next/headers';
import {hasStaffSession,staffAuthConfigured} from '@/lib/staff-auth';
export const dynamic='force-dynamic';
export default async function Home(){
  const requestHeaders=await headers();
  const request=new Request('https://local.invalid/',{headers:requestHeaders});
  return await hasStaffSession(request)?<Fleet/>:<StaffLogin configured={staffAuthConfigured()}/>;
}
