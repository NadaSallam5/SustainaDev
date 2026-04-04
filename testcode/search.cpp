
#include <vector>
#include <unordered_set>
using namespace std;

vector<int> findCommon(vector<int> a, vector<int> b) {
    unordered_set<int> setA(a.begin(), a.end());
    unordered_set<int> common;

    for (int num : b) {
        if (setA.find(num) != setA.end()) {
            common.insert(num);
        }
    }

    return vector<int>(common.begin(), common.end());
}