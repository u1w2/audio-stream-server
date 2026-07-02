#pragma once

#include <string>

namespace audiostream {

class SingleInstanceGuard {
 public:
  SingleInstanceGuard();
  ~SingleInstanceGuard();

  SingleInstanceGuard(const SingleInstanceGuard&) = delete;
  SingleInstanceGuard& operator=(const SingleInstanceGuard&) = delete;

  bool IsFirstInstance() const;
  void ActivateExistingInstance() const;

 private:
  void* mutexHandle_;
  bool isFirstInstance_;
};

}  // namespace audiostream
