/**
 * Indian states and union territories with their main cities (district headquarters and large towns).
 * Used for sign-up and profile: pick the state, then the city; a city that isn't listed can be typed.
 */
export const INDIA: Record<string, string[]> = {
  'Andaman and Nicobar Islands': ['Port Blair', 'Car Nicobar', 'Diglipur', 'Mayabunder', 'Rangat'],
  'Andhra Pradesh': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Tirupati', 'Rajahmundry', 'Kakinada', 'Kadapa', 'Anantapur', 'Eluru', 'Ongole', 'Vizianagaram', 'Srikakulam', 'Machilipatnam', 'Chittoor', 'Amaravati'],
  'Arunachal Pradesh': ['Itanagar', 'Naharlagun', 'Pasighat', 'Tawang', 'Ziro', 'Bomdila', 'Tezu', 'Along'],
  'Assam': ['Guwahati', 'Dibrugarh', 'Silchar', 'Jorhat', 'Tezpur', 'Nagaon', 'Tinsukia', 'Bongaigaon', 'Dhubri', 'Diphu', 'North Lakhimpur', 'Sivasagar', 'Karimganj', 'Goalpara'],
  'Bihar': ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Darbhanga', 'Purnia', 'Arrah', 'Begusarai', 'Katihar', 'Munger', 'Chhapra', 'Hajipur', 'Sasaram', 'Motihari', 'Siwan', 'Bettiah', 'Bihar Sharif'],
  'Chandigarh': ['Chandigarh'],
  'Chhattisgarh': ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg', 'Rajnandgaon', 'Raigarh', 'Jagdalpur', 'Ambikapur', 'Dhamtari', 'Mahasamund'],
  'Dadra and Nagar Haveli and Daman and Diu': ['Silvassa', 'Daman', 'Diu'],
  'Delhi': ['New Delhi', 'Delhi', 'Dwarka', 'Rohini', 'Saket', 'Vasant Kunj', 'Janakpuri', 'Laxmi Nagar', 'Mayur Vihar', 'Pitampura'],
  'Goa': ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda', 'Bicholim', 'Calangute'],
  'Gujarat': ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Gandhinagar', 'Bhavnagar', 'Jamnagar', 'Junagadh', 'Anand', 'Nadiad', 'Bharuch', 'Vapi', 'Navsari', 'Morbi', 'Mehsana', 'Gandhidham', 'Bhuj', 'Porbandar', 'Valsad', 'Palanpur'],
  'Haryana': ['Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Karnal', 'Hisar', 'Rohtak', 'Sonipat', 'Panchkula', 'Yamunanagar', 'Bhiwani', 'Sirsa', 'Rewari', 'Kurukshetra', 'Jind', 'Bahadurgarh'],
  'Himachal Pradesh': ['Shimla', 'Dharamshala', 'Solan', 'Mandi', 'Kullu', 'Manali', 'Hamirpur', 'Una', 'Bilaspur (HP)', 'Chamba', 'Palampur', 'Nahan'],
  'Jammu and Kashmir': ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla', 'Sopore', 'Kathua', 'Udhampur', 'Pulwama', 'Rajouri', 'Kupwara'],
  'Jharkhand': ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro Steel City', 'Hazaribagh', 'Deoghar', 'Giridih', 'Ramgarh', 'Dumka', 'Phusro', 'Medininagar', 'Chaibasa'],
  'Karnataka': ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi', 'Dharwad', 'Belagavi', 'Kalaburagi', 'Davanagere', 'Ballari', 'Vijayapura', 'Shivamogga', 'Tumakuru', 'Udupi', 'Hassan', 'Raichur', 'Bidar', 'Mandya', 'Chikkamagaluru', 'Hosapete', 'Karwar'],
  'Kerala': ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Kannur', 'Alappuzha', 'Kottayam', 'Palakkad', 'Malappuram', 'Kasaragod', 'Pathanamthitta', 'Idukki', 'Kalpetta'],
  'Ladakh': ['Leh', 'Kargil'],
  'Lakshadweep': ['Kavaratti', 'Agatti', 'Minicoy', 'Amini'],
  'Madhya Pradesh': ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Dewas', 'Satna', 'Ratlam', 'Rewa', 'Katni', 'Singrauli', 'Burhanpur', 'Khandwa', 'Chhindwara', 'Morena', 'Bhind', 'Guna', 'Shivpuri', 'Vidisha'],
  'Maharashtra': ['Mumbai', 'Pune', 'Thane', 'Navi Mumbai', 'Nagpur', 'Nashik', 'Aurangabad', 'Solapur', 'Kolhapur', 'Amravati', 'Kalyan', 'Vasai-Virar', 'Mira-Bhayandar', 'Bhiwandi', 'Panvel', 'Sangli', 'Jalgaon', 'Akola', 'Latur', 'Ahmednagar', 'Dhule', 'Chandrapur', 'Nanded', 'Satara', 'Ratnagiri', 'Lonavala', 'Alibag', 'Baramati', 'Wardha', 'Yavatmal'],
  'Manipur': ['Imphal', 'Thoubal', 'Bishnupur', 'Churachandpur', 'Kakching', 'Ukhrul'],
  'Meghalaya': ['Shillong', 'Tura', 'Jowai', 'Nongstoin', 'Williamnagar', 'Nongpoh'],
  'Mizoram': ['Aizawl', 'Lunglei', 'Champhai', 'Serchhip', 'Kolasib', 'Saiha'],
  'Nagaland': ['Kohima', 'Dimapur', 'Mokokchung', 'Tuensang', 'Wokha', 'Zunheboto', 'Mon'],
  'Odisha': ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri', 'Balasore', 'Bhadrak', 'Baripada', 'Jharsuguda', 'Jeypore', 'Angul', 'Dhenkanal', 'Kendrapara'],
  'Puducherry': ['Puducherry', 'Karaikal', 'Mahe', 'Yanam'],
  'Punjab': ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Hoshiarpur', 'Pathankot', 'Moga', 'Firozpur', 'Phagwara', 'Kapurthala', 'Barnala', 'Sangrur', 'Rajpura'],
  'Rajasthan': ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner', 'Bhilwara', 'Alwar', 'Bharatpur', 'Sikar', 'Pali', 'Sri Ganganagar', 'Tonk', 'Chittorgarh', 'Jaisalmer', 'Mount Abu', 'Barmer', 'Jhunjhunu', 'Nagaur', 'Banswara'],
  'Sikkim': ['Gangtok', 'Namchi', 'Gyalshing', 'Mangan', 'Rangpo', 'Jorethang'],
  'Tamil Nadu': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Tiruppur', 'Vellore', 'Erode', 'Thoothukudi', 'Thanjavur', 'Dindigul', 'Hosur', 'Nagercoil', 'Kanchipuram', 'Kumbakonam', 'Karur', 'Cuddalore', 'Ooty', 'Kodaikanal'],
  'Telangana': ['Hyderabad', 'Secunderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 'Ramagundam', 'Mahbubnagar', 'Nalgonda', 'Adilabad', 'Siddipet', 'Suryapet', 'Miryalaguda'],
  'Tripura': ['Agartala', 'Udaipur (Tripura)', 'Dharmanagar', 'Kailashahar', 'Belonia', 'Ambassa'],
  'Uttar Pradesh': ['Lucknow', 'Kanpur', 'Noida', 'Greater Noida', 'Ghaziabad', 'Agra', 'Varanasi', 'Prayagraj', 'Meerut', 'Bareilly', 'Aligarh', 'Moradabad', 'Gorakhpur', 'Saharanpur', 'Jhansi', 'Mathura', 'Firozabad', 'Ayodhya', 'Muzaffarnagar', 'Shahjahanpur', 'Rampur', 'Etawah', 'Mirzapur', 'Bulandshahr', 'Sitapur'],
  'Uttarakhand': ['Dehradun', 'Haridwar', 'Roorkee', 'Haldwani', 'Rudrapur', 'Kashipur', 'Rishikesh', 'Nainital', 'Mussoorie', 'Almora', 'Pithoragarh'],
  'West Bengal': ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Bardhaman', 'Kharagpur', 'Haldia', 'Malda', 'Baharampur', 'Krishnanagar', 'Darjeeling', 'Jalpaiguri', 'Bally', 'Barasat', 'Salt Lake City', 'New Town']
};

export const INDIA_STATES = Object.keys(INDIA).sort((a, b) => a.localeCompare(b));
/** The state a listed city belongs to (first match), or null for a city that isn't listed. */
export const stateOfCity = (city: string) => INDIA_STATES.find(s => INDIA[s]!.some(c => c.toLowerCase() === city.trim().toLowerCase())) ?? null;

/**
 * A person's name: letters in any script, with spaces, dots, apostrophes, hyphens, & and brackets; at least two letters,
 * and no digits (so "12345" or "Priya2" is refused).
 */
export const NAME_RULE = /^(?=(?:.*\p{L}){2})[\p{L}\p{M}][\p{L}\p{M} .'’&(),-]*$/u;
export const NAME_MESSAGE = 'Enter a real name using letters, not numbers.';
export const isPersonName = (s: string) => NAME_RULE.test(s.trim()) && s.trim().length <= 60;
/** A place or pet name: must contain a letter (digits are fine, e.g. "Tower 2B" or "R2"). */
export const hasLetter = (s: string) => /\p{L}/u.test(s);
